import type { ReportAnswerStatus } from "../shared/report";
import "./answer-status.css";

const labels: Record<ReportAnswerStatus, string> = {
  correct: "正解",
  incorrect: "不正解",
  unanswered: "未回答",
  notOpened: "受付前",
  ineligible: "対象外",
  unasked: "未出題",
};

export function AnswerStatus({
  status,
  suffix = "",
}: {
  status: ReportAnswerStatus;
  suffix?: string;
}) {
  return (
    <span className={`report-status report-status-${status}`}>
      {labels[status]}
      {suffix}
    </span>
  );
}
