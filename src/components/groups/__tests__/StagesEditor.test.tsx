import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StagesEditor } from "../StagesEditor";

const stages = [
  { id: "new", label: "New", color: "#94a3b8" },
  { id: "talking", label: "Talking", color: "#94a3b8" },
];

describe("StagesEditor", () => {
  it("removes an empty stage without asking", () => {
    const onChange = vi.fn();
    render(<StagesEditor stages={stages} onChange={onChange} membershipCounts={{}} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove stage" })[1]);
    expect(onChange).toHaveBeenCalledWith([stages[0]]);
  });

  it("asks in the app's dialog before removing a stage that holds members, and cancel keeps it", async () => {
    const onChange = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<StagesEditor stages={stages} onChange={onChange} membershipCounts={{ talking: 2 }} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove stage" })[1]);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/2 members currently in it will move to "New"/)).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "Remove stage" })[1]);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove stage" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([stages[0]]));
    confirmSpy.mockRestore();
  });
});
