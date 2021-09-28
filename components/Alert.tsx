import * as React from "react";
import { ValeAlert } from "../types";
import { Icon } from "./Icon";

interface Props {
  alert: ValeAlert;
  onClick: (alert: ValeAlert) => void;
}

export const Alert = ({ alert, onClick }: Props) => {
  return (
    <div
      className="alert"
      onClick={(e) => {
        // Ignore click when clicking the link.
        if ((e.target as any).nodeName === "DIV") {
          onClick(alert);
        }
      }}
    >
      <div className="alert__header">
        <div className="alert__severity">{alert.Severity}</div>
        <div className="alert__check">{alert.Check}</div>
        {alert.Link && (
          <>
            <div style={{ flexGrow: 1 }} />
            <a href={alert.Link} className="alert__link">
              <Icon name="info" />
            </a>
          </>
        )}
      </div>
      <div className="alert__message">{alert.Message}</div>
      <div className="alert__match">{alert.Match}</div>
    </div>
  );
};
