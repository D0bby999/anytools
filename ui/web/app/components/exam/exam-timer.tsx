import { Badge } from "~/components/doc/badge";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { clock } from "~/lib/exam-types";

/**
 * The time left, on the server's clock. The offset between the server's
 * `server_now` and this browser's clock is taken once, so a laptop whose
 * clock is five minutes out still shows the time the server will mark by.
 *
 * Past the deadline it counts the time over rather than stopping: a late
 * submission is accepted and flagged, never refused.
 */
export function ExamTimer({ deadline, serverNow }: { deadline: string; serverNow: string }) {
  const { t } = useTranslation("study");
  const [offset] = useState(() => Date.parse(serverNow) - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [offset]);

  const left = (Date.parse(deadline) - now) / 1000;
  const over = left < 0;
  return (
    <Badge type={left < 300 ? "warning" : "info"} className="font-mono">
      <span className="sr-only">{over ? t("exams.take.overLabel") : t("exams.take.leftLabel")} </span>
      {over ? t("exams.take.over", { time: clock(-left) }) : t("exams.take.left", { time: clock(left) })}
    </Badge>
  );
}
