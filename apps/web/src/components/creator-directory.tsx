"use client";

import type {
  CreatorChannelRecord,
  CreatorChannelType,
  CreatorDirectoryRecord,
} from "@landed/contracts";
import { ActionButton, Eyebrow, Status } from "@landed/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { z } from "zod";

import { CreatorEvidenceDrawer } from "@/components/creator-evidence-drawer";
import styles from "./creator-directory.module.css";
import { project } from "@/lib/demo-data";

const channelLabels: Record<CreatorChannelType, string> = {
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  podcast: "Podcast",
  telegram: "Telegram",
  discord: "Discord",
  other: "Other",
};

type EvidenceFilter = "all" | "observed" | "missing";

function primaryChannel(creator: CreatorDirectoryRecord) {
  return (
    creator.channels.find((channel) => channel.isPrimary) ?? creator.channels[0]
  );
}

function formatAudience(audienceSize: number | null) {
  if (audienceSize === null) {
    return "NOT RECORDED";
  }

  return new Intl.NumberFormat("en-GB", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(audienceSize);
}

function channelEvidence(channel: CreatorChannelRecord | undefined) {
  if (!channel?.observedAt) {
    return null;
  }

  return {
    date: new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(channel.observedAt)),
    source: channel.sourceLabel,
  };
}

function displayLanguage(code: string) {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "language" }).of(code) ??
      code.toUpperCase()
    );
  } catch {
    return code.toUpperCase();
  }
}

function formatCurrentRate(creator: CreatorDirectoryRecord) {
  if (!creator.currentRate) {
    return null;
  }

  const symbols = {
    GBP: "£",
    USD: "$",
    EUR: "€",
  } as const;
  const amountMinor = BigInt(creator.currentRate.amountMinor);
  const major = amountMinor / 100n;
  const minor = amountMinor % 100n;

  return {
    amount: `${symbols[creator.currentRate.currencyCode]}${new Intl.NumberFormat(
      "en-GB",
    ).format(major)}${
      minor === 0n ? "" : `.${minor.toString().padStart(2, "0")}`
    } ${creator.currentRate.currencyCode}`,
    date: new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(creator.currentRate.quotedAt)),
  };
}

function DirectoryHeader({
  isCreating,
  onAddToBasket,
  selectedCount,
  basketAction,
}: {
  isCreating?: boolean;
  onAddToBasket: () => void;
  selectedCount: number;
  basketAction?: ReactNode;
}) {
  return (
    <header className="page-header creator-directory__header">
      <div>
        <Eyebrow>Creator intelligence</Eyebrow>
        <h1>Creators</h1>
        <p>
          Compare audience fit, package costs and the evidence behind each
          creator.
        </p>
      </div>
      {basketAction ?? (
        <ActionButton
          aria-busy={isCreating}
          disabled={selectedCount === 0 || isCreating}
          onClick={onAddToBasket}
          type="button"
        >
          {isCreating
            ? "CREATING BASKET…"
            : selectedCount === 0
              ? "SELECT KOLS"
              : `SELECT ${selectedCount} FOR BASKET SETUP`}
        </ActionButton>
      )}
    </header>
  );
}

export function CreatorDirectoryPermission() {
  return (
    <div className={styles.root}>
      <DirectoryHeader onAddToBasket={() => undefined} selectedCount={0} />
      <section className="directory-state" aria-labelledby="permission-title">
        <Eyebrow>PROJECT ACCESS REQUIRED</Eyebrow>
        <h2 id="permission-title">This creator roster is not available.</h2>
        <p>
          Ask a workspace administrator for access to this project. No creator
          evidence has been exposed.
        </p>
      </section>
    </div>
  );
}

export function CreatorDirectory({
  creators,
  initialCreatorId = null,
  renderBasketAction,
  newPlansAvailable = true,
  projectSlug = project.id,
}: {
  newPlansAvailable?: boolean;
  projectSlug?: string;
  creators: CreatorDirectoryRecord[];
  initialCreatorId?: string | null;
  renderBasketAction?: (creatorIds: string[]) => ReactNode;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<CreatorChannelType | "all">("all");
  const [language, setLanguage] = useState("all");
  const [topic, setTopic] = useState("all");
  const [evidence, setEvidence] = useState<EvidenceFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [basketNotice, setBasketNotice] = useState("");
  const [isCreatingBasket, setIsCreatingBasket] = useState(false);
  const [activeCreatorId, setActiveCreatorId] = useState<string | null>(() =>
    initialCreatorId && creators.some(({ id }) => id === initialCreatorId)
      ? initialCreatorId
      : null,
  );

  const channelOptions = useMemo(
    () =>
      Array.from(
        new Set(
          creators.flatMap((creator) =>
            creator.channels.map(({ type }) => type),
          ),
        ),
      ).sort((left, right) =>
        channelLabels[left].localeCompare(channelLabels[right]),
      ),
    [creators],
  );

  const languageOptions = useMemo(
    () =>
      Array.from(
        new Set(
          creators.flatMap((creator) => [
            ...creator.languageCodes,
            ...creator.channels.flatMap(({ languageCode }) =>
              languageCode ? [languageCode] : [],
            ),
          ]),
        ),
      ).sort(),
    [creators],
  );

  const topicOptions = useMemo(
    () =>
      Array.from(
        new Map(
          creators
            .flatMap((creator) => creator.tags)
            .map((tag) => [tag.slug, tag.name]),
        ),
      ).sort((left, right) => left[1].localeCompare(right[1])),
    [creators],
  );

  const filteredCreators = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();

    return creators.filter((creator) => {
      const searchable = [
        creator.displayName,
        ...creator.channels.map(({ handle }) => handle),
        ...creator.tags.map(({ name }) => name),
      ]
        .join(" ")
        .toLocaleLowerCase();
      const matchesSearch =
        normalizedSearch.length === 0 || searchable.includes(normalizedSearch);
      const matchesChannel =
        channel === "all" ||
        creator.channels.some(({ type }) => type === channel);
      const matchesLanguage =
        language === "all" ||
        creator.languageCodes.includes(language) ||
        creator.channels.some(({ languageCode }) => languageCode === language);
      const matchesTopic =
        topic === "all" || creator.tags.some(({ slug }) => slug === topic);
      const evidenceChannel = primaryChannel(creator);
      const hasEvidence = Boolean(
        evidenceChannel?.audienceSize !== null &&
        evidenceChannel?.audienceSize !== undefined &&
        evidenceChannel.observedAt &&
        evidenceChannel.sourceLabel,
      );
      const matchesEvidence =
        evidence === "all" ||
        (evidence === "observed" && hasEvidence) ||
        (evidence === "missing" && !hasEvidence);

      return (
        matchesSearch &&
        matchesChannel &&
        matchesLanguage &&
        matchesTopic &&
        matchesEvidence
      );
    });
  }, [channel, creators, evidence, language, search, topic]);

  const hasFilters =
    search.length > 0 ||
    channel !== "all" ||
    language !== "all" ||
    topic !== "all" ||
    evidence !== "all";
  const hiddenSelectedCount = Array.from(selectedIds).filter(
    (creatorId) =>
      !filteredCreators.some((creator) => creator.id === creatorId),
  ).length;
  const activeCreator =
    creators.find((creator) => creator.id === activeCreatorId) ?? null;

  function clearFilters() {
    setSearch("");
    setChannel("all");
    setLanguage("all");
    setTopic("all");
    setEvidence("all");
  }

  function toggleCreator(creatorId: string) {
    setBasketNotice("");
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(creatorId)) {
        next.delete(creatorId);
      } else {
        next.add(creatorId);
      }

      return next;
    });
  }

  async function createBasket() {
    if (!newPlansAvailable) return;
    setBasketNotice("");
    setIsCreatingBasket(true);

    try {
      const response = await fetch(`/api/projects/${projectSlug}/baskets`, {
        body: JSON.stringify({ creatorIds: Array.from(selectedIds) }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        basketId?: unknown;
        message?: unknown;
      };
      const parsedBasketId = z.uuid().safeParse(payload.basketId);

      if (!response.ok || !parsedBasketId.success) {
        setBasketNotice(
          typeof payload.message === "string"
            ? payload.message
            : "Basket setup could not be created. Try again.",
        );
        return;
      }

      router.push(`/projects/${projectSlug}/baskets/${parsedBasketId.data}`);
    } catch {
      setBasketNotice(
        "Basket setup could not be created. Check your connection and try again.",
      );
    } finally {
      setIsCreatingBasket(false);
    }
  }

  if (creators.length === 0) {
    return (
      <div className={styles.root}>
        <DirectoryHeader
          onAddToBasket={() => undefined}
          selectedCount={0}
          basketAction={renderBasketAction?.([])}
        />
        <section className="directory-state" aria-labelledby="empty-title">
          <Eyebrow>FIRST ROSTER</Eyebrow>
          <h2 id="empty-title">No creators have been added yet.</h2>
          <p>
            Import a sanitized creator list to begin comparing channels, topics
            and evidence quality.
          </p>
          <ActionButton disabled type="button">
            Import unavailable in this demo
          </ActionButton>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <DirectoryHeader
        isCreating={isCreatingBasket}
        onAddToBasket={createBasket}
        selectedCount={selectedIds.size}
        basketAction={
          renderBasketAction?.(Array.from(selectedIds)) ??
          (!newPlansAvailable ? (
            <p role="status">
              New plans are unavailable in this demo. Browse creators or
              continue a saved campaign plan.
            </p>
          ) : undefined)
        }
      />

      <section className="evidence-notice" aria-label="Evidence status">
        <Status tone="forecast">SEEDED DEMO EVIDENCE</Status>
        <p>
          Where available, audience snapshots are dated and source-labelled.
          Missing observations remain explicit. Demo evidence is not externally
          verified.
        </p>
      </section>

      <section className="directory-toolbar" aria-label="Creator filters">
        <label className="directory-toolbar__search">
          <span>SEARCH</span>
          <input
            aria-label="Search creators"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, handle or topic"
            type="search"
            value={search}
          />
        </label>
        <label>
          <span>CHANNEL</span>
          <select
            aria-label="Filter by channel"
            onChange={(event) =>
              setChannel(event.target.value as CreatorChannelType | "all")
            }
            value={channel}
          >
            <option value="all">All channels</option>
            {channelOptions.map((option) => (
              <option key={option} value={option}>
                {channelLabels[option]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>LANGUAGE</span>
          <select
            aria-label="Filter by language"
            onChange={(event) => setLanguage(event.target.value)}
            value={language}
          >
            <option value="all">All languages</option>
            {languageOptions.map((option) => (
              <option key={option} value={option}>
                {displayLanguage(option)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>TOPIC</span>
          <select
            aria-label="Filter by topic"
            onChange={(event) => setTopic(event.target.value)}
            value={topic}
          >
            <option value="all">All topics</option>
            {topicOptions.map(([slug, name]) => (
              <option key={slug} value={slug}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>EVIDENCE</span>
          <select
            aria-label="Filter by evidence"
            onChange={(event) =>
              setEvidence(event.target.value as EvidenceFilter)
            }
            value={evidence}
          >
            <option value="all">Any evidence</option>
            <option value="observed">Observed</option>
            <option value="missing">Missing</option>
          </select>
        </label>
      </section>

      <div className="directory-summary" aria-live="polite">
        <span>
          {filteredCreators.length} OF {creators.length} CREATORS
        </span>
        <span>
          {selectedIds.size} SELECTED
          {hiddenSelectedCount > 0
            ? ` / ${hiddenSelectedCount} HIDDEN BY FILTERS`
            : ""}
        </span>
        {hasFilters ? (
          <button onClick={clearFilters} type="button">
            CLEAR FILTERS
          </button>
        ) : null}
      </div>

      {basketNotice ? (
        <p className="directory-basket-notice" role="status">
          {basketNotice}
        </p>
      ) : null}

      {filteredCreators.length === 0 ? (
        <section
          className="directory-state directory-state--filtered"
          aria-labelledby="filtered-empty-title"
        >
          <Eyebrow>NO MATCHES</Eyebrow>
          <h2 id="filtered-empty-title">No creators match these filters.</h2>
          <p>Your existing selection is retained while you adjust the view.</p>
          <ActionButton onClick={clearFilters} type="button">
            CLEAR FILTERS
          </ActionButton>
        </section>
      ) : (
        <section
          className="creator-directory-table"
          aria-labelledby="creator-table-title"
        >
          <div className="table-heading">
            <div>
              <Eyebrow>ROSTER EVIDENCE</Eyebrow>
              <h2 id="creator-table-title">Creator evidence at a glance</h2>
            </div>
            <span>
              {newPlansAvailable
                ? "Select creators for campaign planning"
                : "Open a creator to inspect evidence"}
            </span>
          </div>
          <div className="creator-directory-grid" role="table">
            <div
              className="creator-directory-row creator-directory-row--head"
              role="row"
            >
              <span role="columnheader">Select</span>
              <span role="columnheader">Creator</span>
              <span role="columnheader">Channels</span>
              <span role="columnheader">Topics</span>
              <span role="columnheader">Audience</span>
              <span role="columnheader">Rate</span>
              <span role="columnheader">Evidence</span>
              <span role="columnheader">Relationship</span>
            </div>
            {filteredCreators.map((creator, index) => {
              const mainChannel = primaryChannel(creator);
              const evidenceSnapshot = channelEvidence(mainChannel);
              const currentRate = formatCurrentRate(creator);
              const isSelected = selectedIds.has(creator.id);

              return (
                <div
                  className={`creator-directory-row${
                    isSelected ? " is-selected" : ""
                  }`}
                  key={creator.id}
                  role="row"
                >
                  <span className="creator-select-cell" role="cell">
                    <input
                      aria-label={`Select ${creator.displayName}`}
                      checked={isSelected}
                      disabled={!newPlansAvailable}
                      onChange={() => toggleCreator(creator.id)}
                      type="checkbox"
                    />
                  </span>
                  <span className="creator-cell" role="cell">
                    <span className="avatar" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <button
                      aria-label={`Open evidence for ${creator.displayName}`}
                      className="creator-profile-trigger"
                      onClick={() => setActiveCreatorId(creator.id)}
                      type="button"
                    >
                      <strong>{creator.displayName}</strong>
                      <small>{mainChannel?.handle ?? "NO HANDLE"}</small>
                    </button>
                  </span>
                  <span className="directory-cell" role="cell">
                    <small>CHANNELS</small>
                    <strong>
                      {creator.channels.length > 0
                        ? creator.channels
                            .map(({ type }) => channelLabels[type])
                            .join(" + ")
                        : "NOT RECORDED"}
                    </strong>
                  </span>
                  <span className="directory-cell" role="cell">
                    <small>TOPICS</small>
                    <strong>
                      {creator.tags.length > 0
                        ? creator.tags.map(({ name }) => name).join(" / ")
                        : "NOT TAGGED"}
                    </strong>
                  </span>
                  <span className="directory-cell" role="cell">
                    <small>
                      AUDIENCE
                      {mainChannel
                        ? ` / ${channelLabels[mainChannel.type]}`
                        : ""}
                    </small>
                    <strong>
                      {formatAudience(mainChannel?.audienceSize ?? null)}
                    </strong>
                  </span>
                  <span className="directory-cell" role="cell">
                    <small>INDICATIVE PACKAGE</small>
                    {currentRate ? (
                      <>
                        <strong>{currentRate.amount}</strong>
                        <span>QUOTED {currentRate.date}</span>
                      </>
                    ) : (
                      <strong>NO RATE EVIDENCE</strong>
                    )}
                  </span>
                  <span className="directory-cell" role="cell">
                    <small>
                      EVIDENCE
                      {mainChannel
                        ? ` / ${channelLabels[mainChannel.type]}`
                        : ""}
                    </small>
                    {evidenceSnapshot ? (
                      <>
                        <strong>{evidenceSnapshot.date}</strong>
                        <span>
                          {evidenceSnapshot.source ?? "SOURCE NOT LABELLED"}
                        </span>
                      </>
                    ) : (
                      <strong>NO OBSERVATION</strong>
                    )}
                  </span>
                  <span className="directory-cell" role="cell">
                    <small>RELATIONSHIP</small>
                    <Status>{creator.relationshipStatus.toUpperCase()}</Status>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {activeCreator ? (
        <CreatorEvidenceDrawer
          creator={activeCreator}
          isSelected={selectedIds.has(activeCreator.id)}
          key={activeCreator.id}
          onClose={() => setActiveCreatorId(null)}
          onToggleSelection={() => toggleCreator(activeCreator.id)}
          selectionAvailable={newPlansAvailable}
          projectId={projectSlug}
        />
      ) : null}
    </div>
  );
}
