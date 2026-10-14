import { Eyebrow, Status } from "@landed/ui";
import Link from "next/link";
import type {
  ProjectRecordSummary,
  RecordSection,
} from "@/lib/project-record-index";
import { recordPageSize } from "@/lib/project-record-index";

export function ProjectRecordIndex({
  section,
  projectId,
  records,
  page,
  hasNext,
  denied = false,
}: {
  section: RecordSection;
  projectId: string;
  records: ProjectRecordSummary[];
  page: number;
  hasNext: boolean;
  denied?: boolean;
}) {
  const label = section === "baskets" ? "Baskets" : "Campaigns";
  return (
    <>
      <header className="page-header">
        <div>
          <Eyebrow>
            {section === "baskets"
              ? "03 / COMMERCIAL PLANNING"
              : "04 / CAMPAIGN OPERATIONS"}
          </Eyebrow>
          <h1>{label.toUpperCase()}</h1>
          <p>
            Choose the {section === "baskets" ? "basket" : "campaign"} you want
            to continue. Opening this section does not switch you to another
            record.
          </p>
        </div>
      </header>
      {denied ? (
        <section className="directory-state">
          <h2>Project access is required.</h2>
          <p>
            Ask a workspace administrator for access. No {section} are shown.
          </p>
          <Status>PERMISSION REQUIRED</Status>
        </section>
      ) : (
        <>
          <section className="panel" aria-label={`${label} in this project`}>
            <header className="panel__header">
              <h2>
                {records.length
                  ? "Continue your work"
                  : page > 1
                    ? "No more records on this page"
                    : `No ${section} yet`}
              </h2>
            </header>
            {records.length ? (
              <ul className="decision-list project-record-list">
                {records.map((record, index) => (
                  <li key={record.id}>
                    <span className="decision-index">
                      {String((page - 1) * recordPageSize + index + 1).padStart(
                        2,
                        "0",
                      )}
                    </span>
                    <div>
                      <Link
                        href={`/projects/${projectId}/${section}/${record.id}`}
                      >
                        <strong>
                          {record.name.trim() ||
                            `Untitled ${section === "baskets" ? "basket" : "campaign"}`}
                        </strong>
                      </Link>
                      <span>
                        Updated{" "}
                        {new Intl.DateTimeFormat("en-GB", {
                          dateStyle: "medium",
                          timeZone: "UTC",
                        }).format(new Date(record.updated_at))}{" "}
                        · Record {record.id.slice(-8)}
                      </span>
                    </div>
                    <Status>
                      {record.status?.toUpperCase() ?? "REVIEW TERMS"}
                    </Status>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="form-message">
                {page > 1
                  ? "Return to the previous page or start of this list."
                  : section === "baskets"
                    ? "Select creators to start a basket, then define the commercial terms."
                    : "Continue from an approved basket to create its campaign roster."}
              </p>
            )}
          </section>
          <nav aria-label={`${label} pages`} className="project-record-pages">
            {page > 1 ? (
              <>
                <Link href={`/projects/${projectId}/${section}`}>
                  FIRST PAGE
                </Link>
                <Link
                  href={`/projects/${projectId}/${section}?page=${page - 1}`}
                >
                  PREVIOUS PAGE
                </Link>
              </>
            ) : null}
            <span>Page {page}</span>
            {hasNext ? (
              <Link href={`/projects/${projectId}/${section}?page=${page + 1}`}>
                NEXT PAGE
              </Link>
            ) : null}
          </nav>
          <Link
            className="action-button action-button--secondary"
            href={`/projects/${projectId}/${section === "baskets" ? "kols" : "baskets"}`}
          >
            {section === "baskets" ? "CHOOSE CREATORS" : "OPEN BASKETS"}
          </Link>
        </>
      )}
    </>
  );
}
