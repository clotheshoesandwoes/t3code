import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isListedThreadLineage, type ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  Columns3Icon,
  GripVerticalIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { type DragEvent, type ReactNode, useState } from "react";

import { ComposerHandleContext } from "../../composerHandleContext";
import { useDiffPanelStore } from "../../diffPanelStore";
import { isElectron } from "../../env";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { addThreadsToLanes, laneLayout, MAX_LANES, useLanesStore } from "../../lanesStore";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import { cn } from "../../lib/utils";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { useRightPanelStore } from "../../rightPanelStore";
import { useQuietThreadShell, useVisibleThreadShells } from "../../state/entities";
import { useEnvironmentShellHasSnapshot } from "../../state/shell";
import { buildThreadRouteParams } from "../../threadRoutes";
import ChatView from "../ChatView";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { resolveSidebarThreadStatus, resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuSearchInput, MenuSeparator, MenuTrigger } from "../ui/menu";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

const LANE_DRAG_TYPE = "application/x-t3-lane";

/** Every lane's chat, side by side, so several agents can be watched and steered at once. */
export function LanesPage() {
  const lanes = useLanesStore((state) => state.lanes);
  const zoomedKey = useLanesStore((state) => state.zoomedKey);
  const clear = useLanesStore((state) => state.clear);
  // One flat keyed grid, so reordering or focusing a lane never remounts another lane's chat.
  const layout = zoomedKey === null ? laneLayout(lanes.length) : null;

  return (
    <SidebarInset
      {...workspaceAreaProps("lanes", 1, "Lanes")}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <WorkspacePageHeader electron={isElectron}>
        <Columns3Icon className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="text-sm font-medium">Lanes</h1>
        <span className="text-xs text-muted-foreground tabular-nums">
          {lanes.length}/{MAX_LANES}
        </span>
        <div className="ms-auto flex items-center gap-1 [-webkit-app-region:no-drag]">
          <AddLaneMenu disabled={lanes.length >= MAX_LANES} />
          {lanes.length > 0 ? (
            <Button variant="ghost-muted" size="compact" onClick={clear}>
              Close all
            </Button>
          ) : null}
        </div>
      </WorkspacePageHeader>
      {lanes.length === 0 ? (
        <LanesEmptyState />
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-px overflow-hidden border-t border-border bg-border"
          style={{
            gridTemplateColumns: `repeat(${layout?.columns ?? 1}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout?.rows ?? 1}, minmax(0, 1fr))`,
          }}
        >
          {lanes.map((ref, index) => {
            const key = scopedThreadKey(ref);
            return (
              <Lane
                key={key}
                threadRef={ref}
                index={index}
                zoomed={zoomedKey !== null}
                hidden={zoomedKey !== null && zoomedKey !== key}
                span={layout?.spans[index] ?? 1}
              />
            );
          })}
        </div>
      )}
    </SidebarInset>
  );
}

function LanesEmptyState() {
  return (
    <Empty className="flex-1">
      <EmptyHeader className="max-w-md">
        <EmptyMedia variant="icon">
          <Columns3Icon />
        </EmptyMedia>
        <EmptyTitle>Run your agents side by side</EmptyTitle>
        <EmptyDescription>
          Put up to {MAX_LANES} threads in lanes to watch every agent work and reply to any of them
          without switching threads. Add one here, or right-click threads in the sidebar and choose
          Add to lanes.
        </EmptyDescription>
        <div className="mt-5 flex justify-center">
          <AddLaneMenu disabled={false} prominent />
        </div>
      </EmptyHeader>
    </Empty>
  );
}

function AddLaneMenu({ disabled, prominent = false }: { disabled: boolean; prominent?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        disabled={disabled}
        render={
          <Button
            variant={prominent ? "default" : "ghost"}
            size={prominent ? "default" : "compact"}
          />
        }
      >
        <PlusIcon />
        Add lane
      </MenuTrigger>
      <MenuPopup align="end" className="w-80">
        {open ? <ThreadPickerItems /> : null}
      </MenuPopup>
    </Menu>
  );
}

/** Mounted only while the menu is open, so the live thread list costs nothing otherwise. */
function ThreadPickerItems() {
  const shells = useVisibleThreadShells();
  const lanes = useLanesStore((state) => state.lanes);
  const [query, setQuery] = useState("");
  const laneKeys = new Set(lanes.map(scopedThreadKey));
  const candidates = shells
    .filter(
      (thread) =>
        thread.archivedAt === null &&
        isListedThreadLineage(thread.lineage) &&
        !laneKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
    )
    // ISO timestamps sort as strings.
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const active = candidates.filter((thread) => {
    const status = resolveSidebarThreadStatus(thread);
    return status !== "ready" && status !== "waiting";
  });
  const needle = query.trim().toLowerCase();
  const matches = (
    needle === ""
      ? candidates
      : candidates.filter((thread) => thread.title.toLowerCase().includes(needle))
  ).slice(0, 30);
  const room = MAX_LANES - lanes.length;

  return (
    <>
      <MenuSearchInput
        autoFocus
        placeholder="Search threads"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {needle === "" && active.length > 0 ? (
        <>
          <MenuItem
            onClick={() =>
              addThreadsToLanes(
                active.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
              )
            }
          >
            <Columns3Icon />
            <span className="flex-1">Add active threads</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {Math.min(active.length, room)}
            </span>
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      {matches.length === 0 ? (
        <p className="px-2 py-3 text-center text-xs text-muted-foreground">No threads to add</p>
      ) : (
        matches.map((thread) => {
          const pill = resolveThreadStatusPill({ thread });
          return (
            <MenuItem
              key={`${thread.environmentId}:${thread.id}`}
              onClick={() => addThreadsToLanes([scopeThreadRef(thread.environmentId, thread.id)])}
            >
              <span
                aria-hidden
                className={cn("size-1.5 shrink-0 rounded-full", pill?.dotClass ?? "bg-transparent")}
              />
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
            </MenuItem>
          );
        })
      )}
    </>
  );
}

function Lane(props: {
  readonly threadRef: ScopedThreadRef;
  readonly index: number;
  readonly zoomed: boolean;
  /** Kept mounted but out of view while another lane is focused. */
  readonly hidden: boolean;
  readonly span: number;
}) {
  const { threadRef, index, zoomed, hidden, span } = props;
  const key = scopedThreadKey(threadRef);
  const navigate = useNavigate();
  const shell = useQuietThreadShell(threadRef);
  const snapshotLoaded = useEnvironmentShellHasSnapshot(threadRef.environmentId);
  const remove = useLanesStore((state) => state.remove);
  const move = useLanesStore((state) => state.move);
  const toggleZoom = useLanesStore((state) => state.toggleZoom);
  const [dropTarget, setDropTarget] = useState(false);
  const pill = shell ? resolveThreadStatusPill({ thread: shell }) : null;

  const openThread = () =>
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) });
  // A lane has no diff panel or terminal of its own, so both open the full thread.
  const [panel] = useState<SideChatParentPanel>(() => ({
    openToolDiff: (target) => {
      useDiffPanelStore.getState().selectToolCall(threadRef, target);
      useRightPanelStore.getState().open(threadRef, "diff");
      openThread();
    },
    runShellCommand: (command) => {
      void writeTextToClipboard(command).then((copied) => {
        if (copied) {
          toastManager.add({
            type: "info",
            title: "Command copied",
            description: "Lanes has no terminal. Paste it into this thread's terminal.",
          });
        }
      });
      openThread();
    },
  }));

  const onDragStart = (event: DragEvent) => {
    event.dataTransfer.setData(LANE_DRAG_TYPE, key);
    event.dataTransfer.effectAllowed = "move";
  };
  const acceptsDrop = (event: DragEvent) => event.dataTransfer.types.includes(LANE_DRAG_TYPE);

  return (
    <section
      data-side-chat-pane
      aria-label={shell?.title ?? "Lane"}
      hidden={hidden}
      inert={hidden}
      style={{ gridColumn: `span ${span}` }}
      className={cn(
        "@container relative flex min-h-0 min-w-0 flex-col bg-background",
        // ChatView sizes its gutters by viewport width; a lane is narrow even on a wide screen.
        "[&_.chat-composer-lane]:px-2! [&_.messages-timeline-scroll]:px-2!",
        hidden && "hidden",
        dropTarget &&
          "after:pointer-events-none after:absolute after:inset-0 after:ring-2 after:ring-primary/60 after:ring-inset",
      )}
      onDragOver={(event) => {
        if (!acceptsDrop(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(true);
      }}
      onDragLeave={(event) => {
        // Moving onto a child also fires dragleave; only clear once the pointer leaves the lane.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(false);
      }}
      onDrop={(event) => {
        setDropTarget(false);
        const from = event.dataTransfer.getData(LANE_DRAG_TYPE);
        if (from) move(from, key);
      }}
    >
      <header
        draggable={!zoomed}
        onDragStart={onDragStart}
        onDoubleClick={() => toggleZoom(key)}
        className="group/lane flex h-9 shrink-0 items-center gap-1.5 border-b border-border pr-1 pl-1.5"
      >
        {zoomed ? null : (
          <GripVerticalIcon
            aria-hidden
            className="size-3.5 shrink-0 cursor-grab text-muted-foreground/50 group-hover/lane:text-muted-foreground"
          />
        )}
        <span className="w-3 shrink-0 text-center text-2xs text-muted-foreground tabular-nums">
          {index + 1}
        </span>
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            pill ? pill.dotClass : "bg-muted-foreground/30",
            pill?.pulse && "motion-safe:animate-status-pulse",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {shell?.title ?? (snapshotLoaded ? "Thread unavailable" : "Loading…")}
        </span>
        {pill ? (
          <span className={cn("hidden shrink-0 text-2xs @[22rem]:inline", pill.colorClass)}>
            {pill.label}
          </span>
        ) : null}
        <LaneButton
          label={zoomed ? "Show all lanes" : "Focus lane"}
          onClick={() => toggleZoom(key)}
        >
          {zoomed ? <Minimize2Icon /> : <Maximize2Icon />}
        </LaneButton>
        <LaneButton label="Open thread" onClick={openThread} disabled={shell === null}>
          <ArrowUpRightIcon />
        </LaneButton>
        <LaneButton label="Close lane" onClick={() => remove(key)}>
          <XIcon />
        </LaneButton>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {shell === null ? (
          snapshotLoaded ? (
            <p className="p-3 text-xs text-muted-foreground">
              This thread was deleted or its environment is not connected.
            </p>
          ) : null
        ) : (
          <BackgroundThreadContext value>
            <ComposerHandleContext value={null}>
              <ChatView
                environmentId={threadRef.environmentId}
                threadId={threadRef.threadId}
                routeKind="server"
                embedded={panel}
              />
            </ComposerHandleContext>
          </BackgroundThreadContext>
        )}
      </div>
    </section>
  );
}

function LaneButton(props: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}
