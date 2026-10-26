import type { ProposalChoice } from "../shared/types";
import "./proposal-title.css";

export function ProposalTitle({ proposal }: { proposal: ProposalChoice }) {
  return (
    <span className="proposal-title">
      <span className="proposal-number">{proposal.number}</span>
      <span className="proposal-original" lang="en">
        {proposal.title}
      </span>
      {proposal.titleJa !== null && (
        <span className="proposal-japanese" lang="ja">
          {proposal.titleJa}
        </span>
      )}
    </span>
  );
}
