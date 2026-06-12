import type { Gate } from "../types";
import { qaGate } from "./qa";
import { reviewGate } from "./review";
import { shipGate } from "./ship";
import { verifyGate } from "./verify";

const GATES: Record<string, Gate> = {
  verify: verifyGate,
  ship: shipGate,
  review: reviewGate,
  qa: qaGate,
};

/** Resolve configured gate ids to implementations. Unknown ids throw at arm time, not mid-run. */
export function resolveGates(ids: string[]): Gate[] {
  return ids.map((id) => {
    const gate = GATES[id];
    if (!gate) {
      throw new Error(
        `Unknown gate "${id}" in pi-autopilot config (known: ${Object.keys(GATES).join(", ")})`,
      );
    }
    return gate;
  });
}
