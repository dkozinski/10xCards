import { useEffect, useState } from "react";

// Whole seconds since `active` last became true; 0 while inactive.
// Measured from a start timestamp rather than by counting ticks, so a throttled
// background tab still shows the real elapsed time when it wakes up.
export function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    // runs when the request finishes (active → false) and on unmount; the reset
    // means the next run starts from 0 instead of flashing the previous total
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [active]);

  return elapsed;
}
