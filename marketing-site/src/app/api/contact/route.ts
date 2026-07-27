import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";

const contactSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email").max(200),
  phone: z.string().max(20).optional(),
  salonName: z.string().max(100).optional(),
  message: z.string().min(10, "Message must be at least 10 characters").max(2000),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = contactSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { name, email, phone, salonName, message } = parsed.data;

    const apiKey = process.env.RESEND_API_KEY;
    const contactEmail = process.env.CONTACT_EMAIL;
    if (!apiKey || !contactEmail) {
      return NextResponse.json(
        { error: "Contact delivery is not configured", code: "DELIVERY_NOT_CONFIGURED" },
        { status: 503 }
      );
    }

    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM || "Aura Contact <onboarding@resend.dev>",
      to: contactEmail,
      replyTo: email,
      subject: `[Aura Contact] ${name} — ${salonName || "Independent"}`,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        `Phone: ${phone || "Not provided"}`,
        `Salon: ${salonName || "Not provided"}`,
        "",
        "Message:",
        message,
      ].join("\n"),
    });
    if (result.error) {
      console.error("[Contact Delivery Error]", result.error);
      return NextResponse.json({ error: "Contact delivery failed", code: "DELIVERY_FAILED" }, { status: 502 });
    }

    return NextResponse.json({ success: true, message: "Message sent successfully", delivery: "email" });
  } catch (error) {
    console.error("[Contact Form Error]", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
