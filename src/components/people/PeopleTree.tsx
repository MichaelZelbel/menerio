import {
  memo,
  type DragEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Clapperboard,
  ExternalLink,
  FolderPlus,
  Handshake,
  Landmark,
  Merge,
  Pencil,
  Podcast,
  Sparkles,
  Star,
  Trash2,
  UserPlus,
  UserSearch,
  UserX,
  Users,
  UsersRound,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { showToast } from "@/lib/toast";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBulkSelect } from "@/components/notes/useBulkSelect";
import type { Person } from "@/hooks/usePeople";
import type { ContactGroupRow } from "@/hooks/useGroups";
import type { MembershipLite } from "@/hooks/useGroupMemberships";
import {
  buildPeopleTree,
  wouldCreateCycle,
  type GroupLite,
  type GroupTreeNode,
  type PersonLite,
} from "./peopleTreeBuild";
import { PeopleBulkBar } from "./PeopleBulkBar";

// Reuse the Groups page icon idiom so a group's chosen icon renders in the tree.
const iconMap = { Sparkles, Landmark, Clapperboard, Handshake, Podcast, UserSearch, Compass, UsersRound };
function groupIcon(icon?: string | null) {
  return icon && icon in iconMap ? iconMap[icon as keyof typeof iconMap] : Users;
}

const FAVORITES_KEY = "__favorites__";
const RECENT_KEY = "__recent__";
const ALL_KEY = "__all__";
const SEARCH_KEY = "__search__";

export interface PeopleTreeProps {
  people: Person[];
  groups: ContactGroupRow[];
  memberships: MembershipLite[];
  selectedPersonId: string | null;
  searchQuery: string;
  onSelectPerson: (id: string) => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
  onCreateGroup: (parentGroupId: string | null) => void;
  onRenameGroup: (groupId: string, currentName: string) => void;
  onArchiveGroup: (groupId: string) => void;
  onReparentGroup: (groupId: string, parentGroupId: string | null) => void;
  onAddToGroup: (personId: string, groupId: string) => void;
  onRemoveFromGroup: (personId: string, groupId: string) => void;
  onCreatePerson: (groupId: string | null) => void;
  onMergePerson: (personId: string) => void;
  onDeletePerson: (personId: string) => void;
}

// Stable callback bundle passed down to memoized rows.
interface TreeHandlers {
  onSelectPerson: (id: string) => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
  onCreateGroup: (parentGroupId: string | null) => void;
  onRenameGroup: (groupId: string, currentName: string) => void;
  onArchiveGroup: (groupId: string) => void;
  onAddToGroup: (personId: string, groupId: string) => void;
  onRemoveFromGroup: (personId: string, groupId: string) => void;
  onCreatePerson: (groupId: string | null) => void;
  onMergePerson: (personId: string) => void;
  onDeletePerson: (personId: string) => void;
  onOpenGroup: (slug: string) => void;
  onToggleGroup: (groupId: string) => void;
  onDropOnGroup: (event: DragEvent, groupId: string) => void;
  setDraggingKey: (key: string | null) => void;
  setDragOverKey: (key: string | null) => void;
}

interface PersonRowProps {
  person: PersonLite;
  parentKey: string;
  containingGroup: { id: string; name: string } | null;
  depth: number;
  depthStep: number;
  basePad: number;
  selectedPersonId: string | null;
  groupOptions: GroupLite[];
  isChecked: boolean;
  multiActive: boolean;
  draggingKey: string | null;
  bulkClick: (event: MouseEvent, id: string) => boolean;
  handlers: TreeHandlers;
}

const PersonRow = memo(function PersonRow({
  person,
  parentKey,
  containingGroup,
  depth,
  depthStep,
  basePad,
  selectedPersonId,
  groupOptions,
  isChecked,
  multiActive,
  draggingKey,
  bulkClick,
  handlers,
}: PersonRowProps) {
  const isSelected = person.id === selectedPersonId;
  const initial = person.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <a
          href={`/dashboard/people/${person.id}`}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("application/x-person-id", person.id);
            event.dataTransfer.effectAllowed = "copy";
            const el = event.currentTarget;
            setTimeout(() => el.classList.add("opacity-40"), 0);
            handlers.setDraggingKey(`person:${person.id}`);
          }}
          onDragEnd={(event) => {
            event.currentTarget.classList.remove("opacity-40");
            handlers.setDraggingKey(null);
            handlers.setDragOverKey(null);
          }}
          onClick={(event) => {
            const consumed = bulkClick(event, person.id);
            if (consumed) return;
            if (event.button === 0) {
              event.preventDefault();
              handlers.onSelectPerson(person.id);
            }
          }}
          className={cn(
            "group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-sm transition-colors hover:bg-accent/60 cursor-grab active:cursor-grabbing",
            isSelected && !multiActive && "bg-accent text-accent-foreground",
            isChecked && "bg-primary/10 hover:bg-primary/15",
            draggingKey === `person:${person.id}` && "opacity-40",
          )}
          style={{ paddingLeft: `${basePad + depth * depthStep}px` }}
        >
          {/* The row is an <a href>: any click that isn't explicitly
              preventDefault-ed triggers a NATIVE full-page navigation (the
              span's stopPropagation alone only silences the React handler —
              the browser still follows the link and wipes all state). So the
              checkbox handles its own click: preventDefault kills the anchor's
              default action, stopPropagation keeps the row handler out, and
              the toggle is driven directly from here. Radix skips its internal
              toggle on defaultPrevented events, so state stays fully ours. */}
          <span
            className="shrink-0"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <Checkbox
              checked={isChecked}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                bulkClick(
                  { metaKey: true, preventDefault() {}, stopPropagation() {} } as unknown as MouseEvent,
                  person.id,
                );
              }}
              aria-label={`Select ${person.name}`}
              className={cn("h-3.5 w-3.5", multiActive ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
            />
          </span>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
            {initial}
          </span>
          <span className="min-w-0 flex-1 truncate">{person.name}</span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handlers.onToggleFavorite(person.id, !person.is_favorite);
            }}
            title={person.is_favorite ? "Remove from favorites" : "Add to favorites"}
            className={cn(
              "shrink-0 text-muted-foreground transition-opacity hover:text-warning",
              person.is_favorite ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <Star className={cn("h-3.5 w-3.5", person.is_favorite && "fill-warning text-warning")} />
          </button>
        </a>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={() => handlers.onSelectPerson(person.id)}>Open</ContextMenuItem>
        <ContextMenuItem onClick={() => handlers.onToggleFavorite(person.id, !person.is_favorite)}>
          <Star className={cn("mr-2 h-3.5 w-3.5", person.is_favorite && "fill-warning text-warning")} />
          {person.is_favorite ? "Unfavorite" : "Favorite"}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <UserPlus className="mr-2 h-3.5 w-3.5" /> Add to group
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
            {groupOptions.length === 0 ? (
              <ContextMenuItem disabled>No groups yet</ContextMenuItem>
            ) : (
              groupOptions.map((group) => (
                <ContextMenuItem key={group.id} onClick={() => handlers.onAddToGroup(person.id, group.id)}>
                  {group.name}
                </ContextMenuItem>
              ))
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        {containingGroup && (
          <ContextMenuItem onClick={() => handlers.onRemoveFromGroup(person.id, containingGroup.id)}>
            <UserX className="mr-2 h-3.5 w-3.5" /> Remove from "{containingGroup.name}"
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => handlers.onMergePerson(person.id)}>
          <Merge className="mr-2 h-3.5 w-3.5" /> Merge…
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => handlers.onDeletePerson(person.id)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

interface GroupRowProps {
  node: GroupTreeNode;
  depth: number;
  depthStep: number;
  basePad: number;
  expanded: Set<string>;
  selectedPersonId: string | null;
  groupOptions: GroupLite[];
  draggingKey: string | null;
  dragOverKey: string | null;
  multiActive: boolean;
  isChecked: (id: string) => boolean;
  bulkClick: (event: MouseEvent, id: string) => boolean;
  handlers: TreeHandlers;
}

const GroupRow = memo(function GroupRow({
  node,
  depth,
  depthStep,
  basePad,
  expanded,
  selectedPersonId,
  groupOptions,
  draggingKey,
  dragOverKey,
  multiActive,
  isChecked,
  bulkClick,
  handlers,
}: GroupRowProps) {
  const group = node.group;
  const key = `group:${group.id}`;
  const isOpen = expanded.has(key);
  const Icon = groupIcon(group.icon);
  const isDragOver = dragOverKey === group.id && draggingKey !== key;

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-group-id", group.id);
              event.dataTransfer.effectAllowed = "move";
              const el = event.currentTarget;
              setTimeout(() => el.classList.add("opacity-40"), 0);
              handlers.setDraggingKey(key);
            }}
            onDragEnd={(event) => {
              event.currentTarget.classList.remove("opacity-40");
              handlers.setDraggingKey(null);
              handlers.setDragOverKey(null);
            }}
            onClick={() => handlers.onToggleGroup(group.id)}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = draggingKey?.startsWith("group:") ? "move" : "copy";
              if (dragOverKey !== group.id) handlers.setDragOverKey(group.id);
            }}
            onDragLeave={(event) => {
              const next = event.relatedTarget as Node | null;
              if (next && event.currentTarget.contains(next)) return;
              if (dragOverKey === group.id) handlers.setDragOverKey(null);
            }}
            onDrop={(event) => handlers.onDropOnGroup(event, group.id)}
            className={cn(
              "flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent/60 cursor-grab active:cursor-grabbing",
              isDragOver && "ring-2 ring-primary ring-inset bg-primary/10",
              draggingKey === key && "opacity-40",
            )}
            style={{ paddingLeft: `${8 + depth * depthStep}px` }}
          >
            <span
              role="button"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                handlers.onToggleGroup(group.id);
              }}
              className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
            >
              {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </span>
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{group.name}</span>
            <span className="text-[10px] text-muted-foreground">{node.subtreeCount}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem onClick={() => group.slug && handlers.onOpenGroup(group.slug)}>
            <ExternalLink className="mr-2 h-3.5 w-3.5" /> Open group
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handlers.onCreateGroup(group.id)}>
            <FolderPlus className="mr-2 h-3.5 w-3.5" /> New subgroup
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handlers.onCreatePerson(group.id)}>
            <UserPlus className="mr-2 h-3.5 w-3.5" /> Add person here
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => handlers.onRenameGroup(group.id, group.name)}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Rename…
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handlers.onArchiveGroup(group.id)}>
            <Archive className="mr-2 h-3.5 w-3.5" /> Archive
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isOpen && (
        <div>
          {node.children.map((child) => (
            <GroupRow
              key={child.group.id}
              node={child}
              depth={depth + 1}
              depthStep={depthStep}
              basePad={basePad}
              expanded={expanded}
              selectedPersonId={selectedPersonId}
              groupOptions={groupOptions}
              draggingKey={draggingKey}
              dragOverKey={dragOverKey}
              multiActive={multiActive}
              isChecked={isChecked}
              bulkClick={bulkClick}
              handlers={handlers}
            />
          ))}
          {node.people.map((person) => (
            <PersonRow
              key={`${key}:${person.id}`}
              person={person}
              parentKey={key}
              containingGroup={{ id: group.id, name: group.name }}
              depth={depth + 1}
              depthStep={depthStep}
              basePad={basePad}
              selectedPersonId={selectedPersonId}
              groupOptions={groupOptions}
              isChecked={isChecked(person.id)}
              multiActive={multiActive}
              draggingKey={draggingKey}
              bulkClick={bulkClick}
              handlers={handlers}
            />
          ))}
        </div>
      )}
    </div>
  );
});

interface SectionRowProps {
  sectionKey: string;
  label: string;
  icon: typeof Star;
  people: PersonLite[];
  expanded: Set<string>;
  depthStep: number;
  basePad: number;
  selectedPersonId: string | null;
  groupOptions: GroupLite[];
  draggingKey: string | null;
  multiActive: boolean;
  isChecked: (id: string) => boolean;
  bulkClick: (event: MouseEvent, id: string) => boolean;
  onToggle: (key: string) => void;
  handlers: TreeHandlers;
}

const SectionRow = memo(function SectionRow({
  sectionKey,
  label,
  icon: Icon,
  people,
  expanded,
  depthStep,
  basePad,
  selectedPersonId,
  groupOptions,
  draggingKey,
  multiActive,
  isChecked,
  bulkClick,
  onToggle,
  handlers,
}: SectionRowProps) {
  const isOpen = expanded.has(sectionKey);
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(sectionKey)}
        className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent/60"
        style={{ paddingLeft: "8px" }}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-[10px] text-muted-foreground">{people.length}</span>
      </button>
      {isOpen && (
        <div>
          {people.length === 0 ? (
            <div
              className="text-[11px] italic text-muted-foreground"
              style={{ paddingLeft: `${basePad + depthStep}px`, paddingTop: "2px", paddingBottom: "2px" }}
            >
              None
            </div>
          ) : (
            people.map((person) => (
              <PersonRow
                key={`${sectionKey}:${person.id}`}
                person={person}
                parentKey={sectionKey}
                containingGroup={null}
                depth={1}
                depthStep={depthStep}
                basePad={basePad}
                selectedPersonId={selectedPersonId}
                groupOptions={groupOptions}
                isChecked={isChecked(person.id)}
                multiActive={multiActive}
                draggingKey={draggingKey}
                bulkClick={bulkClick}
                handlers={handlers}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
});

export function PeopleTree({
  people,
  groups,
  memberships,
  selectedPersonId,
  searchQuery,
  onSelectPerson,
  onToggleFavorite,
  onCreateGroup,
  onRenameGroup,
  onArchiveGroup,
  onReparentGroup,
  onAddToGroup,
  onRemoveFromGroup,
  onCreatePerson,
  onMergePerson,
  onDeletePerson,
}: PeopleTreeProps) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const depthStep = isMobile ? 8 : 14;
  const basePad = isMobile ? 8 : 14;

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ALL_KEY]));
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Map DB group rows (parent_group_id lives in the DB but not yet in the
  // generated types) into the pure module's GroupLite shape.
  const groupLites = useMemo<GroupLite[]>(
    () =>
      groups.map((g) => ({
        id: g.id,
        name: g.name,
        parent_group_id: (g as unknown as { parent_group_id: string | null }).parent_group_id ?? null,
        archived_at: g.archived_at,
        is_trashed: g.is_trashed,
        icon: g.icon,
        slug: g.slug,
      })),
    [groups],
  );

  const tree = useMemo(
    () => buildPeopleTree({ people, groups: groupLites, memberships }),
    [people, groupLites, memberships],
  );

  const groupOptions = useMemo(
    () =>
      groupLites
        .filter((g) => !g.archived_at && !g.is_trashed)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [groupLites],
  );

  const favorites = useMemo(
    () => people.filter((p) => p.is_favorite).sort((a, b) => a.name.localeCompare(b.name)),
    [people],
  );

  const recent = useMemo(
    () =>
      people
        .filter((p) => p.last_viewed_at)
        .sort((a, b) => new Date(b.last_viewed_at!).getTime() - new Date(a.last_viewed_at!).getTime())
        .slice(0, 15),
    [people],
  );

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return people
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.aliases || []).some((a) => a.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [people, searchQuery]);

  const searching = searchQuery.trim().length > 0;

  // Auto-expand the branches that contain the selected person so its highlight
  // is reachable (groups it belongs to + their ancestors, or the relevant
  // virtual section). Mirrors NoteTree's ancestor auto-expand.
  useEffect(() => {
    if (!selectedPersonId) return;
    const parentById = new Map(groupLites.map((g) => [g.id, g.parent_group_id] as const));
    const keys = new Set<string>([ALL_KEY]);
    let inGroup = false;
    memberships
      .filter((m) => m.contact_id === selectedPersonId)
      .forEach((m) => {
        let current: string | null | undefined = m.group_id;
        const seen = new Set<string>();
        while (current && !seen.has(current)) {
          seen.add(current);
          if (parentById.has(current)) {
            keys.add(`group:${current}`);
            inGroup = true;
          }
          current = parentById.get(current) ?? null;
        }
      });
    if (!inGroup) {
      const person = people.find((p) => p.id === selectedPersonId);
      if (person?.is_favorite) keys.add(FAVORITES_KEY);
    }
    setExpanded((current) => {
      let changed = false;
      const next = new Set(current);
      keys.forEach((k) => {
        if (!next.has(k)) {
          next.add(k);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [selectedPersonId, memberships, groupLites, people]);

  const toggle = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((groupId: string) => toggle(`group:${groupId}`), [toggle]);

  // Unique person ids in render order — anchors shift-range bulk selection.
  const visiblePersonIds = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (id: string) => {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    };
    if (searching) {
      searchResults.forEach((p) => push(p.id));
      return out;
    }
    if (expanded.has(FAVORITES_KEY)) favorites.forEach((p) => push(p.id));
    if (expanded.has(RECENT_KEY)) recent.forEach((p) => push(p.id));
    if (expanded.has(ALL_KEY)) {
      const walk = (node: GroupTreeNode) => {
        if (!expanded.has(`group:${node.group.id}`)) return;
        node.children.forEach(walk);
        node.people.forEach((p) => push(p.id));
      };
      tree.roots.forEach(walk);
      tree.ungrouped.forEach((p) => push(p.id));
    }
    return out;
  }, [searching, searchResults, expanded, favorites, recent, tree]);

  const bulk = useBulkSelect(visiblePersonIds);
  const multiActive = bulk.size > 0;
  const selectedIds = useMemo(() => Array.from(bulk.selected), [bulk.selected]);

  const handleDropOnGroup = useCallback(
    (event: DragEvent, targetGroupId: string) => {
      event.preventDefault();
      setDragOverKey(null);
      const groupId = event.dataTransfer.getData("application/x-group-id");
      if (groupId) {
        if (groupId === targetGroupId) return;
        if (wouldCreateCycle(groupLites, groupId, targetGroupId)) {
          showToast.error("Can't move a group into its own subgroup");
          return;
        }
        onReparentGroup(groupId, targetGroupId);
        return;
      }
      const personId = event.dataTransfer.getData("application/x-person-id");
      if (personId) onAddToGroup(personId, targetGroupId);
    },
    [groupLites, onReparentGroup, onAddToGroup],
  );

  const handleDropOnRoot = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDragOverKey(null);
      const groupId = event.dataTransfer.getData("application/x-group-id");
      if (groupId) onReparentGroup(groupId, null);
    },
    [onReparentGroup],
  );

  const handlers = useMemo<TreeHandlers>(
    () => ({
      onSelectPerson,
      onToggleFavorite,
      onCreateGroup,
      onRenameGroup,
      onArchiveGroup,
      onAddToGroup,
      onRemoveFromGroup,
      onCreatePerson,
      onMergePerson,
      onDeletePerson,
      onOpenGroup: (slug: string) => navigate(`/dashboard/groups/${slug}`),
      onToggleGroup: toggleGroup,
      onDropOnGroup: handleDropOnGroup,
      setDraggingKey,
      setDragOverKey,
    }),
    [
      onSelectPerson,
      onToggleFavorite,
      onCreateGroup,
      onRenameGroup,
      onArchiveGroup,
      onAddToGroup,
      onRemoveFromGroup,
      onCreatePerson,
      onMergePerson,
      onDeletePerson,
      navigate,
      toggleGroup,
      handleDropOnGroup,
    ],
  );

  const allExpanded = expanded.has(ALL_KEY);
  const allDragOver = dragOverKey === ALL_KEY && draggingKey?.startsWith("group:");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-2">
        {searching ? (
          searchResults.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">No people found</div>
          ) : (
            searchResults.map((person) => (
              <PersonRow
                key={`${SEARCH_KEY}:${person.id}`}
                person={person}
                parentKey={SEARCH_KEY}
                containingGroup={null}
                depth={0}
                depthStep={depthStep}
                basePad={basePad}
                selectedPersonId={selectedPersonId}
                groupOptions={groupOptions}
                isChecked={bulk.isSelected(person.id)}
                multiActive={multiActive}
                draggingKey={draggingKey}
                bulkClick={bulk.handleClick}
                handlers={handlers}
              />
            ))
          )
        ) : (
          <>
            <SectionRow
              sectionKey={FAVORITES_KEY}
              label="Favorites"
              icon={Star}
              people={favorites}
              expanded={expanded}
              depthStep={depthStep}
              basePad={basePad}
              selectedPersonId={selectedPersonId}
              groupOptions={groupOptions}
              draggingKey={draggingKey}
              multiActive={multiActive}
              isChecked={bulk.isSelected}
              bulkClick={bulk.handleClick}
              onToggle={toggle}
              handlers={handlers}
            />
            <SectionRow
              sectionKey={RECENT_KEY}
              label="Recent"
              icon={Clock}
              people={recent}
              expanded={expanded}
              depthStep={depthStep}
              basePad={basePad}
              selectedPersonId={selectedPersonId}
              groupOptions={groupOptions}
              draggingKey={draggingKey}
              multiActive={multiActive}
              isChecked={bulk.isSelected}
              bulkClick={bulk.handleClick}
              onToggle={toggle}
              handlers={handlers}
            />

            {/* "All people" root — container for root groups + drop target that
                reparents a dragged group to the top level. */}
            <div>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => toggle(ALL_KEY)}
                    onDragOver={(event) => {
                      if (!draggingKey?.startsWith("group:")) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      if (dragOverKey !== ALL_KEY) setDragOverKey(ALL_KEY);
                    }}
                    onDragLeave={(event) => {
                      const next = event.relatedTarget as Node | null;
                      if (next && event.currentTarget.contains(next)) return;
                      if (dragOverKey === ALL_KEY) setDragOverKey(null);
                    }}
                    onDrop={handleDropOnRoot}
                    className={cn(
                      "flex h-7 w-full items-center gap-1 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent/60",
                      allDragOver && "ring-2 ring-primary ring-inset bg-primary/10",
                    )}
                    style={{ paddingLeft: "8px" }}
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground">
                      {allExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </span>
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">All people</span>
                    <span className="text-[10px] text-muted-foreground">{people.length}</span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-52">
                  <ContextMenuItem onClick={() => onCreateGroup(null)}>
                    <FolderPlus className="mr-2 h-3.5 w-3.5" /> New group
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onCreatePerson(null)}>
                    <UserPlus className="mr-2 h-3.5 w-3.5" /> Add person
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {allExpanded && (
                <div>
                  {tree.roots.length === 0 ? (
                    <div
                      className="text-[11px] italic text-muted-foreground"
                      style={{ paddingLeft: `${basePad + depthStep}px`, paddingTop: "2px", paddingBottom: "2px" }}
                    >
                      No groups yet
                    </div>
                  ) : (
                    tree.roots.map((node) => (
                      <GroupRow
                        key={node.group.id}
                        node={node}
                        depth={1}
                        depthStep={depthStep}
                        basePad={basePad}
                        expanded={expanded}
                        selectedPersonId={selectedPersonId}
                        groupOptions={groupOptions}
                        draggingKey={draggingKey}
                        dragOverKey={dragOverKey}
                        multiActive={multiActive}
                        isChecked={bulk.isSelected}
                        bulkClick={bulk.handleClick}
                        handlers={handlers}
                      />
                    ))
                  )}
                </div>
              )}
            </div>

            <SectionRow
              sectionKey={UNGROUPED_KEY}
              label="Ungrouped"
              icon={UserX}
              people={tree.ungrouped}
              expanded={expanded}
              depthStep={depthStep}
              basePad={basePad}
              selectedPersonId={selectedPersonId}
              groupOptions={groupOptions}
              draggingKey={draggingKey}
              multiActive={multiActive}
              isChecked={bulk.isSelected}
              bulkClick={bulk.handleClick}
              onToggle={toggle}
              handlers={handlers}
            />
          </>
        )}
      </div>

      {multiActive && (
        <PeopleBulkBar selectedIds={selectedIds} groups={groupOptions} onClear={bulk.clear} />
      )}
    </div>
  );
}
