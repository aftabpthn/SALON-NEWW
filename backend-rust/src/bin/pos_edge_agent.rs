use std::{
    env,
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{bail, Context, Result};
use reqwest::{Client, RequestBuilder};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::{fs, process::Command, time};

#[derive(Clone)]
struct Config {
    api_base: String,
    access_token: String,
    tenant_id: String,
    branch_id: String,
    terminal_id: String,
    fingerprint: String,
    spool_dir: PathBuf,
    print_program: String,
    print_args: Vec<String>,
    poll_seconds: u64,
    heartbeat_seconds: u64,
}

#[derive(Deserialize)]
struct Envelope<T> {
    data: T,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrintJob {
    id: String,
    sale_id: String,
    format: String,
}

#[derive(Deserialize, Serialize)]
struct SpoolItem {
    job: PrintJob,
    file: PathBuf,
    printed: bool,
}

impl Config {
    fn load() -> Result<Self> {
        let api_base = required("POS_EDGE_API_BASE")?
            .trim_end_matches('/')
            .to_string();
        validate_api_base(&api_base)?;
        let print_args = env::var("POS_EDGE_PRINT_ARGS_JSON")
            .ok()
            .map(|value| serde_json::from_str::<Vec<String>>(&value))
            .transpose()
            .context("POS_EDGE_PRINT_ARGS_JSON must be a JSON string array")?
            .unwrap_or_else(|| vec!["{file}".into()]);
        Ok(Self {
            api_base,
            access_token: required("POS_EDGE_ACCESS_TOKEN")?,
            tenant_id: required("POS_EDGE_TENANT_ID")?,
            branch_id: required("POS_EDGE_BRANCH_ID")?,
            terminal_id: required("POS_EDGE_TERMINAL_ID")?,
            fingerprint: required("POS_EDGE_DEVICE_FINGERPRINT")?,
            spool_dir: env::var("POS_EDGE_SPOOL_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("data/pos-edge-spool")),
            print_program: required("POS_EDGE_PRINT_PROGRAM")?,
            print_args,
            poll_seconds: positive_env("POS_EDGE_POLL_SECONDS", 2)?,
            heartbeat_seconds: positive_env("POS_EDGE_HEARTBEAT_SECONDS", 15)?,
        })
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let config = Config::load()?;
    fs::create_dir_all(&config.spool_dir)
        .await
        .context("failed to create POS edge spool")?;
    let client = Client::builder().timeout(Duration::from_secs(20)).build()?;
    let mut heartbeat = time::interval(Duration::from_secs(config.heartbeat_seconds));
    let mut poll = time::interval(Duration::from_secs(config.poll_seconds));
    println!(
        "POS edge agent connected to terminal {}",
        config.terminal_id
    );

    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => break,
            _ = heartbeat.tick() => {
                if let Err(error) = send_heartbeat(&client, &config).await { eprintln!("heartbeat failed: {error:#}"); }
            }
            _ = poll.tick() => {
                if let Err(error) = poll_once(&client, &config).await { eprintln!("print poll failed: {error:#}"); }
            }
        }
    }
    Ok(())
}

async fn send_heartbeat(client: &Client, config: &Config) -> Result<()> {
    let path = format!(
        "/api/v1/pos/terminals/{}/heartbeat",
        safe_id(&config.terminal_id)?
    );
    api(
        config,
        client
            .post(format!("{}{path}", config.api_base))
            .json(&json!({"deviceFingerprint":config.fingerprint})),
    )
    .send()
    .await?
    .error_for_status()?;
    Ok(())
}

async fn poll_once(client: &Client, config: &Config) -> Result<()> {
    if process_spool(client, config).await? {
        return Ok(());
    }
    let response = api(
        config,
        client
            .get(format!("{}/api/v1/pos/print-jobs/next", config.api_base))
            .query(&[("terminalId", &config.terminal_id)]),
    )
    .send()
    .await?
    .error_for_status()?
    .json::<Envelope<Option<PrintJob>>>()
    .await?;
    let Some(job) = response.data else {
        return Ok(());
    };
    let job_id = safe_id(&job.id)?.to_string();
    let sale_id = safe_id(&job.sale_id)?;
    let layout = if job.format == "thermal" {
        "thermal"
    } else {
        "a4"
    };
    let printable = api(
        config,
        client
            .get(format!(
                "{}/api/v1/pos/invoices/{sale_id}/pdf",
                config.api_base
            ))
            .query(&[("layout", layout)]),
    )
    .send()
    .await?
    .error_for_status()?
    .bytes()
    .await?
    .to_vec();
    let file = config.spool_dir.join(format!("{job_id}.pdf"));
    atomic_write(&file, &printable).await?;
    let item = SpoolItem {
        job,
        file,
        printed: false,
    };
    atomic_json(&config.spool_dir.join(format!("{job_id}.json")), &item).await?;
    process_spool(client, config).await?;
    println!("queued local {layout} print {job_id}");
    Ok(())
}

async fn process_spool(client: &Client, config: &Config) -> Result<bool> {
    let mut entries = fs::read_dir(&config.spool_dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let mut item: SpoolItem = serde_json::from_slice(&fs::read(&path).await?)?;
        if !item.printed {
            let status = run_print(config, &item.file).await?;
            if !status.success() {
                report_result(
                    client,
                    config,
                    &item.job.id,
                    "failed",
                    "print command failed",
                )
                .await?;
                remove_spool(&path, &item.file).await;
                return Ok(true);
            }
            item.printed = true;
            atomic_json(&path, &item).await?;
        }
        report_result(client, config, &item.job.id, "printed", "").await?;
        remove_spool(&path, &item.file).await;
        return Ok(true);
    }
    Ok(false)
}

async fn run_print(config: &Config, file: &Path) -> Result<std::process::ExitStatus> {
    let file = file
        .canonicalize()
        .context("spooled print file is missing")?;
    let mut command = Command::new(&config.print_program);
    for arg in &config.print_args {
        command.arg(arg.replace("{file}", &file.to_string_lossy()));
    }
    command
        .status()
        .await
        .context("failed to start print program")
}

async fn report_result(
    client: &Client,
    config: &Config,
    job_id: &str,
    status: &str,
    error: &str,
) -> Result<()> {
    let job_id = safe_id(job_id)?;
    api(
        config,
        client
            .post(format!(
                "{}/api/v1/pos/print-jobs/{job_id}/result",
                config.api_base
            ))
            .json(&json!({"status":status,"error":error})),
    )
    .send()
    .await?
    .error_for_status()?;
    Ok(())
}

fn api(config: &Config, request: RequestBuilder) -> RequestBuilder {
    request
        .bearer_auth(&config.access_token)
        .header("x-tenant-id", &config.tenant_id)
        .header("x-branch-id", &config.branch_id)
}

async fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    atomic_write(path, &serde_json::to_vec(value)?).await
}

async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).await?;
    if fs::metadata(path).await.is_ok() {
        fs::remove_file(path).await?;
    }
    fs::rename(temporary, path).await?;
    Ok(())
}

async fn remove_spool(metadata: &Path, file: &Path) {
    let _ = fs::remove_file(metadata).await;
    let _ = fs::remove_file(file).await;
}

fn required(name: &str) -> Result<String> {
    let value = env::var(name).with_context(|| format!("{name} is required"))?;
    if value.trim().is_empty() {
        bail!("{name} is required");
    }
    Ok(value)
}

fn positive_env(name: &str, default: u64) -> Result<u64> {
    let value = env::var(name)
        .ok()
        .map(|v| v.parse::<u64>())
        .transpose()
        .with_context(|| format!("{name} must be a positive integer"))?
        .unwrap_or(default);
    if value == 0 {
        bail!("{name} must be a positive integer");
    }
    Ok(value)
}

fn validate_api_base(value: &str) -> Result<()> {
    if value.starts_with("https://")
        || value.starts_with("http://127.0.0.1")
        || value.starts_with("http://localhost")
    {
        return Ok(());
    }
    bail!("POS_EDGE_API_BASE must use HTTPS, except for loopback development")
}

fn safe_id(value: &str) -> Result<&str> {
    if !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Ok(value);
    }
    bail!("POS identifier contains unsupported characters")
}

#[cfg(test)]
mod tests {
    use super::{safe_id, validate_api_base};

    #[test]
    fn edge_boundaries_reject_unsafe_urls_and_ids() {
        assert!(validate_api_base("https://pos.example.com").is_ok());
        assert!(validate_api_base("http://127.0.0.1:8080").is_ok());
        assert!(validate_api_base("http://pos.example.com").is_err());
        assert!(safe_id("terminal_1-a").is_ok());
        assert!(safe_id("../terminal").is_err());
    }
}
