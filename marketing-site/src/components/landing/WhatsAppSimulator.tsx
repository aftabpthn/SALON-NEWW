"use client";

import { useState } from "react";
import { MessageSquare, Send, CheckCheck, Sparkles, Calendar, Clock, User, ShieldCheck } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

type Message = {
  id: string;
  sender: "user" | "bot";
  text: string;
  time: string;
  options?: string[];
  card?: {
    service: string;
    stylist: string;
    slot: string;
    price: string;
  };
};

export function WhatsAppSimulator() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      sender: "user",
      text: "Hi Aura AI! Need to book a Hair Spa & Cut for tomorrow evening.",
      time: "04:15 PM",
    },
    {
      id: "2",
      sender: "bot",
      text: "Namaste Priya! 🙏 I found 3 open slots for Hair Spa & Cut with Senior Stylist Ananya at Bandra West tomorrow:",
      time: "04:15 PM",
      options: ["Book 04:30 PM", "Book 06:00 PM", "Book 07:15 PM"],
    },
  ]);

  const [bookingConfirmed, setBookingConfirmed] = useState(false);

  const handleOptionClick = (option: string) => {
    const timeStr = option.replace("Book ", "");
    
    // Add user response message
    const userMsg: Message = {
      id: String(Date.now()),
      sender: "user",
      text: option,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // Add bot confirmation card message
    const botMsg: Message = {
      id: String(Date.now() + 1),
      sender: "bot",
      text: `Awesome! Your booking is confirmed. We've reserved Senior Stylist Ananya for you. 🎟️`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      card: {
        service: "Signature Hair Spa + Haircut",
        stylist: "Ananya K. (Senior Stylist)",
        slot: `Tomorrow at ${timeStr}`,
        price: "₹2,450 (GST Included)",
      },
    };

    setMessages((prev) => [...prev, userMsg, botMsg]);
    setBookingConfirmed(true);
  };

  const resetDemo = () => {
    setBookingConfirmed(false);
    setMessages([
      {
        id: "1",
        sender: "user",
        text: "Hi Aura AI! Need to book a Hair Spa & Cut for tomorrow evening.",
        time: "04:15 PM",
      },
      {
        id: "2",
        sender: "bot",
        text: "Namaste Priya! 🙏 I found 3 open slots for Hair Spa & Cut with Senior Stylist Ananya at Bandra West tomorrow:",
        time: "04:15 PM",
        options: ["Book 04:30 PM", "Book 06:00 PM", "Book 07:15 PM"],
      },
    ]);
  };

  return (
    <section className="bg-aura-surface py-20 md:py-28 overflow-hidden">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          {/* Left Description */}
          <div>
            <SectionHeading
              badge="Automated Booking"
              title="24/7 WhatsApp AI Booking Concierge"
              subtitle="Let your clients book, reschedule, and pay via WhatsApp in under 30 seconds — without a single manual call or missed lead."
              align="left"
            />
            <div className="mt-8 space-y-4">
              <div className="flex items-start gap-3 rounded-2xl border border-aura-border bg-white p-4 shadow-sm">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-aura-text">Instant Multi-Lingual AI Assistant</h4>
                  <p className="mt-1 text-xs leading-5 text-aura-text-secondary">
                    Responds in English, Hindi, and regional languages instantly. Reads live slot schedules directly from your POS.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-2xl border border-aura-border bg-white p-4 shadow-sm">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-aura-burgundy text-white">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-aura-text">Zero No-Show Guarantee</h4>
                  <p className="mt-1 text-xs leading-5 text-aura-text-secondary">
                    Auto-sends WhatsApp reminders 2 hours before the slot with 1-click confirmation or quick reschedule buttons.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Simulated WhatsApp Phone Window */}
          <div className="mx-auto w-full max-w-md">
            <div className="overflow-hidden rounded-[2.5rem] border-4 border-gray-900 bg-emerald-950/20 shadow-2xl">
              {/* WhatsApp Header */}
              <div className="flex items-center gap-3 bg-[#075e54] p-4 text-white">
                <div className="relative">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-700 text-sm font-bold">
                    A
                  </div>
                  <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#075e54] bg-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold leading-tight">Aura Salon AI Concierge ✓</h3>
                  <p className="text-[10px] text-emerald-200">Official WhatsApp Business • Online</p>
                </div>
              </div>

              {/* WhatsApp Chat Body */}
              <div className="h-[380px] overflow-y-auto bg-[#e5ddd5] p-4 space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl p-3 text-xs leading-5 shadow-sm ${
                        msg.sender === "user"
                          ? "rounded-tr-none bg-[#dcf8c6] text-gray-900"
                          : "rounded-tl-none bg-white text-gray-900"
                      }`}
                    >
                      <p>{msg.text}</p>

                      {/* Interactive Option Pills */}
                      {msg.options && !bookingConfirmed && (
                        <div className="mt-3 flex flex-wrap gap-1.5 pt-2 border-t border-gray-100">
                          {msg.options.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => handleOptionClick(opt)}
                              className="rounded-full bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition-transform hover:scale-105 active:scale-95 shadow-sm"
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Confirmed Ticket Card */}
                      {msg.card && (
                        <div className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3 space-y-1.5 text-[11px]">
                          <div className="flex items-center gap-1.5 text-emerald-800 font-bold">
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>Booking Confirmed Pass</span>
                          </div>
                          <p><strong className="text-gray-700">Service:</strong> {msg.card.service}</p>
                          <p><strong className="text-gray-700">Stylist:</strong> {msg.card.stylist}</p>
                          <p><strong className="text-gray-700">Time:</strong> {msg.card.slot}</p>
                          <div className="flex justify-between border-t border-emerald-200 pt-1.5 font-bold text-emerald-900">
                            <span>Amount Paid:</span>
                            <span>{msg.card.price}</span>
                          </div>
                        </div>
                      )}

                      <span className="mt-1 block text-right text-[9px] text-gray-400">
                        {msg.time} <CheckCheck className="inline h-3 w-3 text-sky-500" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Chat Input Bar */}
              <div className="flex items-center gap-2 bg-[#f0f0f0] p-3 border-t border-gray-200">
                <input
                  type="text"
                  readOnly
                  placeholder={bookingConfirmed ? "Demo completed!" : "Tap an option above..."}
                  className="flex-1 rounded-full bg-white px-4 py-2 text-xs text-gray-600 outline-none"
                />
                {bookingConfirmed ? (
                  <button
                    type="button"
                    onClick={resetDemo}
                    className="rounded-full bg-aura-burgundy px-3 py-2 text-[10px] font-bold text-white shadow-sm"
                  >
                    Reset Demo
                  </button>
                ) : (
                  <button type="button" className="grid h-8 w-8 place-items-center rounded-full bg-emerald-600 text-white">
                    <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
