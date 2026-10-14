import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReviewDeadline } from "./review-deadline";
afterEach(cleanup);
it("shows actual cutoff and says not to wait for cleanup, with no approval control", () => {
  render(
    <ReviewDeadline
      timing={{ decisionsCloseAt: "2026-10-08T01:58:43Z" }}
      expiresAt="2026-10-08T02:00:43Z"
    />,
  );
  expect(document.querySelector("time")).toHaveAttribute(
    "dateTime",
    "2026-10-08T01:58:43Z",
  );
  expect(screen.getByText(/do not wait for cleanup/)).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("does not advertise a later draft expiry if session timing is unconfirmed", () => {
  render(
    <ReviewDeadline
      report
      timing={{ decisionsCloseAt: null }}
      expiresAt="2026-10-08T02:00:43Z"
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("deadline unavailable");
  expect(document.querySelector("time")).toBeNull();
});
it("keeps the final report decision distinct", () => {
  render(
    <ReviewDeadline
      report
      timing={{ decisionsCloseAt: "2026-10-08T02:00:00Z" }}
      expiresAt="2026-10-08T01:50:00Z"
    />,
  );
  expect(
    screen.getByText(/Complete report approval before/),
  ).toBeInTheDocument();
  expect(document.querySelector("time")).toHaveAttribute(
    "dateTime",
    "2026-10-08T01:50:00Z",
  );
});
