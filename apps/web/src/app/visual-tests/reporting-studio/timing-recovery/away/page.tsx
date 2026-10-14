import { notFound } from "next/navigation";
import { basketTimingEnabled } from "@/lib/baskets/timing-enabled";
import { TimingRehearsal } from "../rehearsal";
export default function Page() {
  if (
    !basketTimingEnabled(process.env) ||
    process.env.ENABLE_TIMING_REHEARSAL !== "1"
  )
    notFound();
  return <TimingRehearsal away />;
}
