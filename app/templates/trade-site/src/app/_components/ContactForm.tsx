"use client";

/**
 * Template contact form — uses the shadcn mechanics pack (Label, Input, Textarea, Select, Checkbox).
 * Submit stays `.cta-primary` (not shadcn Button). Opus/Sonnet restyle tokens only.
 */
import { useState, type FormEvent } from "react";
import { Input } from "@/app/_components/ui/input";
import { Textarea } from "@/app/_components/ui/textarea";
import { Label } from "@/app/_components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";
import { Checkbox } from "@/app/_components/ui/checkbox";

export default function ContactForm({
  phoneDisplay = "(555) 000-0000",
  phoneHref = "tel:+15550000000",
  services = ["General inquiry", "Other"] as string[],
}: {
  phoneDisplay?: string;
  phoneHref?: string;
  services?: string[];
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [service, setService] = useState("");
  const [textOk, setTextOk] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (fd.get("_gr_hp_kx")) return;

    const slug = window.location.hostname.split(".")[0];
    try {
      const res = await fetch(`/api/preview/${slug}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          phone: fd.get("phone"),
          email: fd.get("email"),
          message: fd.get("message"),
          service,
          textOk,
          _gr_hp_kx: "",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("sent");
        form.reset();
        setService("");
        setTextOk(false);
      } else {
        setStatus("error");
        setErrorMsg(data.error || "Something went wrong. Please call us instead.");
      }
    } catch {
      setStatus("error");
      setErrorMsg(`Could not send. Call ${phoneDisplay} directly.`);
    }
  }

  if (status === "sent") {
    return (
      <div className="rounded-lg bg-surface-2 p-8 text-center">
        <div className="font-display mb-2 text-xl font-semibold text-accent">Message Sent</div>
        <p className="font-body text-ink-muted">
          We will be in touch shortly. For faster service, call{" "}
          <a href={phoneHref} className="font-semibold text-accent">
            {phoneDisplay}
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="sr-only" aria-hidden="true">
        <input type="text" name="_gr_hp_kx" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required autoComplete="name" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="service">Service Needed</Label>
        <Select value={service} onValueChange={setService}>
          <SelectTrigger id="service" aria-label="Service needed">
            <SelectValue placeholder="Select a service" />
          </SelectTrigger>
          <SelectContent>
            {services.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="service" value={service} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="message">Message</Label>
        <Textarea id="message" name="message" rows={4} />
      </div>
      <div className="flex items-start gap-3">
        <Checkbox id="textOk" checked={textOk} onCheckedChange={(v) => setTextOk(v === true)} />
        <Label htmlFor="textOk" className="font-normal leading-snug text-ink-muted">
          OK to text me about this estimate
        </Label>
      </div>
      {status === "error" && <p className="font-body text-sm text-accent">{errorMsg}</p>}
      <button type="submit" disabled={status === "sending"} className="cta-primary w-full justify-center disabled:opacity-60">
        {status === "sending" ? "Sending..." : "Get Your Free Estimate"}
      </button>
    </form>
  );
}
