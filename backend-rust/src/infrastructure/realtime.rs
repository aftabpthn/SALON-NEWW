use std::time::Duration;

use futures_util::StreamExt;
use redis::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const PUBLISH_TIMEOUT: Duration = Duration::from_secs(3);
const RECONNECT_DELAY: Duration = Duration::from_secs(1);

#[derive(Clone)]
pub struct ClusterSender<T> {
    local: broadcast::Sender<T>,
    cluster: mpsc::Sender<T>,
}

impl<T: Clone> ClusterSender<T> {
    pub fn send(&self, event: T) -> Result<usize, broadcast::error::SendError<T>> {
        if let Err(error) = self.cluster.try_send(event.clone()) {
            tracing::warn!(error = %error, "realtime Redis publish queue unavailable");
        }
        self.local.send(event)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<T> {
        self.local.subscribe()
    }
}

#[derive(Serialize, Deserialize)]
struct ClusterEnvelope<T> {
    source: String,
    event: T,
}

pub fn cluster_channel<T>(redis: Client, channel: &'static str, capacity: usize) -> ClusterSender<T>
where
    T: Clone + Serialize + DeserializeOwned + Send + 'static,
{
    let (local, _) = broadcast::channel(capacity);
    let (cluster, receiver) = mpsc::channel(capacity);
    let source = Uuid::new_v4().to_string();

    tokio::spawn(publish(redis.clone(), channel, source.clone(), receiver));
    tokio::spawn(subscribe(redis, channel, source, local.clone()));

    ClusterSender { local, cluster }
}

async fn publish<T>(
    redis: Client,
    channel: &'static str,
    source: String,
    mut receiver: mpsc::Receiver<T>,
) where
    T: Serialize + Send + 'static,
{
    let mut connection = None;
    while let Some(event) = receiver.recv().await {
        let payload = match serde_json::to_string(&ClusterEnvelope {
            source: source.clone(),
            event,
        }) {
            Ok(payload) => payload,
            Err(error) => {
                tracing::warn!(channel, error = %error, "failed to serialize realtime event");
                continue;
            }
        };

        if connection.is_none() {
            connection = match tokio::time::timeout(
                CONNECT_TIMEOUT,
                redis.get_multiplexed_async_connection(),
            )
            .await
            {
                Ok(Ok(connection)) => Some(connection),
                Ok(Err(error)) => {
                    tracing::warn!(channel, error = %error, "failed to connect realtime publisher");
                    None
                }
                Err(_) => {
                    tracing::warn!(channel, "realtime publisher connection timed out");
                    None
                }
            };
        }

        let Some(mut active) = connection.take() else {
            continue;
        };
        let result = tokio::time::timeout(PUBLISH_TIMEOUT, async {
            let published: redis::RedisResult<i64> = redis::cmd("PUBLISH")
                .arg(channel)
                .arg(payload)
                .query_async(&mut active)
                .await;
            published
        })
        .await;
        match result {
            Ok(Ok(_)) => connection = Some(active),
            Ok(Err(error)) => {
                tracing::warn!(channel, error = %error, "failed to publish realtime event");
            }
            Err(_) => tracing::warn!(channel, "realtime event publish timed out"),
        }
    }
}

async fn subscribe<T>(
    redis: Client,
    channel: &'static str,
    source: String,
    local: broadcast::Sender<T>,
) where
    T: Clone + DeserializeOwned + Send + 'static,
{
    loop {
        let mut pubsub = match tokio::time::timeout(CONNECT_TIMEOUT, redis.get_async_pubsub()).await
        {
            Ok(Ok(pubsub)) => pubsub,
            Ok(Err(error)) => {
                tracing::warn!(channel, error = %error, "failed to connect realtime subscriber");
                tokio::time::sleep(RECONNECT_DELAY).await;
                continue;
            }
            Err(_) => {
                tracing::warn!(channel, "realtime subscriber connection timed out");
                tokio::time::sleep(RECONNECT_DELAY).await;
                continue;
            }
        };
        if let Err(error) = pubsub.subscribe(channel).await {
            tracing::warn!(channel, error = %error, "failed to subscribe to realtime channel");
            tokio::time::sleep(RECONNECT_DELAY).await;
            continue;
        }

        let mut messages = pubsub.on_message();
        while let Some(message) = messages.next().await {
            let payload = match message.get_payload::<String>() {
                Ok(payload) => payload,
                Err(error) => {
                    tracing::warn!(channel, error = %error, "invalid realtime event payload");
                    continue;
                }
            };
            let envelope: ClusterEnvelope<T> = match serde_json::from_str(&payload) {
                Ok(envelope) => envelope,
                Err(error) => {
                    tracing::warn!(channel, error = %error, "invalid realtime event envelope");
                    continue;
                }
            };
            if envelope.source != source {
                let _ = local.send(envelope.event);
            }
        }
        tracing::warn!(channel, "realtime subscriber disconnected; reconnecting");
        tokio::time::sleep(RECONNECT_DELAY).await;
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{cluster_channel, ClusterEnvelope};
    use serde::{Deserialize, Serialize};
    use uuid::Uuid;

    #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
    struct TestEvent {
        id: String,
    }

    #[test]
    fn cluster_envelope_round_trips_source_and_event() {
        let encoded = serde_json::to_string(&ClusterEnvelope {
            source: "replica-a".to_string(),
            event: TestEvent {
                id: "event-1".to_string(),
            },
        })
        .unwrap();
        let decoded: ClusterEnvelope<TestEvent> = serde_json::from_str(&encoded).unwrap();

        assert_eq!(decoded.source, "replica-a");
        assert_eq!(decoded.event.id, "event-1");
    }

    #[tokio::test]
    #[ignore = "requires TEST_REDIS_URL"]
    async fn cluster_channel_fans_out_between_replicas() {
        let redis_url = std::env::var("TEST_REDIS_URL").expect("TEST_REDIS_URL is required");
        let redis = redis::Client::open(redis_url).unwrap();
        let channel =
            Box::leak(format!("aurashine:test:realtime:{}", Uuid::new_v4()).into_boxed_str());
        let first: super::ClusterSender<TestEvent> = cluster_channel(redis.clone(), channel, 8);
        let second: super::ClusterSender<TestEvent> = cluster_channel(redis.clone(), channel, 8);
        let mut remote = second.subscribe();
        let mut connection = redis.get_multiplexed_async_connection().await.unwrap();
        let subscribers = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let counts: Vec<(String, i64)> = redis::cmd("PUBSUB")
                    .arg("NUMSUB")
                    .arg(&*channel)
                    .query_async(&mut connection)
                    .await
                    .unwrap();
                if counts.first().is_some_and(|(_, count)| *count == 2) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await;
        assert!(subscribers.is_ok(), "replicas did not subscribe to Redis");

        let _ = first.send(TestEvent {
            id: "cross-replica".to_string(),
        });
        let received = tokio::time::timeout(Duration::from_secs(3), remote.recv())
            .await
            .expect("cross-replica event timed out")
            .expect("cross-replica channel closed");

        assert_eq!(received.id, "cross-replica");
    }
}
