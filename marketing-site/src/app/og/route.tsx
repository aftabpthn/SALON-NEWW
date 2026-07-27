import { ImageResponse } from "next/og";

export const runtime = "edge";

const titles: Record<string, string> = {
  "/": "Aura — The Living Salon Operating System",
  "/platform": "Aura Platform — Owner CRM, Customer App, Staff App",
  "/owner-crm": "Owner CRM & POS — Aura Salon OS",
  "/customer-app": "Customer App — Book, Manage, Return",
  "/staff-app": "Staff App — Shifts, Attendance, Performance",
  "/workflows": "Connected Workflows — Booking to Revenue",
  "/pricing": "Aura Pricing — Plans for Every Salon",
  "/demo": "Book a Demo — See Aura in Action",
  "/about": "About Aura — Built for Indian Salons",
  "/faq": "Aura FAQ — Answers to Common Questions",
  "/contact": "Contact Aura — Get in Touch",
  "/blog": "Aura Blog — Salon Business Insights",
  "/features": "Aura Features — Complete Salon Platform",
  "/privacy": "Aura Privacy Policy",
  "/terms": "Aura Terms of Service",
  "/cookies": "Aura Cookie Policy",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path") || "/";
  const title = titles[path] || "Aura — Salon Operating System";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          backgroundColor: "#171415",
          padding: "80px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background pattern */}
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "500px",
            height: "500px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(104,31,55,0.3) 0%, transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-100px",
            left: "30%",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(184,115,67,0.15) 0%, transparent 70%)",
          }}
        />

        {/* Aura logo mark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "40px",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              backgroundColor: "#681f37",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fffaf2",
              fontSize: "28px",
              fontStyle: "italic",
              fontFamily: "Georgia, serif",
            }}
          >
            A
          </div>
          <span
            style={{
              color: "#fffaf2",
              fontSize: "24px",
              fontFamily: "Georgia, serif",
              letterSpacing: "-0.03em",
            }}
          >
            Aura
          </span>
        </div>

        {/* Title */}
        <div
          style={{
            color: "#fffaf2",
            fontSize: title.length > 50 ? "42px" : "52px",
            fontFamily: "Georgia, serif",
            fontWeight: "bold",
            lineHeight: "1.1",
            maxWidth: "900px",
            letterSpacing: "-0.03em",
          }}
        >
          {title}
        </div>

        {/* Subtitle */}
        <div
          style={{
            color: "rgba(255,255,255,0.5)",
            fontSize: "20px",
            marginTop: "24px",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          salon operating system · CRM · POS · booking · staff · inventory · finance
        </div>

        {/* Bottom accent line */}
        <div
          style={{
            position: "absolute",
            bottom: "60px",
            left: "80px",
            right: "80px",
            height: "2px",
            background: "linear-gradient(to right, #681f37, #b87343, #567565)",
            borderRadius: "1px",
          }}
        />
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
