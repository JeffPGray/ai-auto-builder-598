"use client";

/**
 * Template estimate dialog — bluegrass API (biz defaults) so SiteNav can omit props.
 */
import Link from "next/link";
import { biz } from "./site-data";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/app/_components/ui/dialog";

export default function EstimateDialog({
  phone = biz.phone,
  phoneHref = biz.phoneHref,
  triggerClassName = "cta-primary text-sm",
  triggerLabel = "Free Estimate",
  priceLine,
}: {
  phone?: string;
  phoneHref?: string;
  triggerClassName?: string;
  triggerLabel?: string;
  priceLine?: string;
}) {
  const smsHref = `sms:${phone.replace(/\D/g, "")}?body=${encodeURIComponent("Hi — need a quote. Photo attached.")}`;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className={triggerClassName}>
          {triggerLabel}
        </button>
      </DialogTrigger>
      <DialogContent className="bg-surface-1 border-surface-3 max-w-md">
        <DialogHeader>
          <DialogTitle>Get a free estimate</DialogTitle>
          <DialogDescription>
            We call back personally. Text a photo of the area for the fastest quote.
          </DialogDescription>
        </DialogHeader>
        <div className="font-body space-y-3 text-sm text-ink">
          {priceLine ? <p>{priceLine}</p> : null}
          <a href={phoneHref} className="cta-primary w-full justify-center text-base">
            Call {phone}
          </a>
          <a href={smsHref} className="cta-secondary-ink w-full justify-center text-base">
            Text a photo
          </a>
        </div>
        <DialogFooter className="sm:justify-start">
          <Link href="/contact" className="font-body text-sm font-semibold text-accent hover:underline">
            Or send a message on the contact page →
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
