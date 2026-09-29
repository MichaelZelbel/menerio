import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MembershipSheet } from "../MembershipSheet";

const mocks = vi.hoisted(() => ({ update: vi.fn(), archive: vi.fn(), remove: vi.fn() }));

vi.mock("@/hooks/useGroupMemberships", () => ({
  useUpdateMembership: () => ({ mutate: mocks.update, isPending: false }),
  useArchiveMembership: () => ({ mutate: mocks.archive, isPending: false }),
  useRemoveMembership: () => ({ mutate: mocks.remove, isPending: false }),
}));
vi.mock("../NextStepsSection", () => ({ NextStepsSection: () => null }));
vi.mock("@/lib/toast", () => ({ showToast: { success: vi.fn(), error: vi.fn() } }));

const group = {
  id: "g1",
  name: "Investors",
  stages: [{ id: "new", label: "New" }],
  attributes_schema: { check_size: { type: "number", label: "Check size" }, fund: { type: "text", label: "Fund" } },
} as never;

const membership = {
  id: "m1",
  contact_id: "p1",
  group_id: "g1",
  status: "new",
  priority: "normal",
  reason: "Met at the summit",
  notes: null,
  attributes: { check_size: 50, fund: "Seed Fund" },
  contacts: { id: "p1", name: "Ada Lovelace", aliases: [] },
} as never;

function renderSheet(onOpenChange = vi.fn()) {
  render(
    <MemoryRouter>
      <MembershipSheet group={group} membership={membership} notes={[]} open onOpenChange={onOpenChange} />
    </MemoryRouter>,
  );
  return onOpenChange;
}

describe("MembershipSheet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves typed Reason and Notes when the sheet is closed with Escape, before any blur", async () => {
    const onOpenChange = renderSheet();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Warm intro from Bob" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Follow up in May" } });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0]).toEqual({
      id: "m1",
      groupId: "g1",
      personId: "p1",
      reason: "Warm intro from Bob",
      notes: "Follow up in May",
    });
  });

  it("saves a typed attribute on close, keeping the other attributes", async () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText("Fund"), { target: { value: "Growth Fund" } });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update.mock.calls[0][0].attributes).toEqual({ check_size: 50, fund: "Growth Fund" });
  });

  it("does not save the same text twice when a blur is followed by a close", async () => {
    const onOpenChange = renderSheet();
    const reason = screen.getByLabelText("Reason");
    fireEvent.change(reason, { target: { value: "Warm intro" } });
    fireEvent.blur(reason);
    expect(mocks.update).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("saves nothing when nothing was typed", async () => {
    const onOpenChange = renderSheet();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
