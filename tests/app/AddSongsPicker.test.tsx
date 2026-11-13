import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AddSongsPicker from "../../src/app/components/AddSongsPicker";

const mk = (id: string, title: string, artist = "Band") => ({
  id, title, artist, sourceUrl: null, originalKey: "A", bandKey: "A", capo: 0, updatedAt: "x",
});
const songs = [mk("s1", "Alpha"), mk("s4", "Delta"), mk("s3", "Gamma", "Zed")];

function setup(props: Partial<{ busy: boolean; saved: boolean }> = {}) {
  const onAdd = vi.fn(async () => props.saved ?? true);
  const view = render(<AddSongsPicker songs={songs} busy={props.busy ?? false} onAdd={onAdd} />);
  return { onAdd, ...view };
}

describe("AddSongsPicker", () => {
  it("filters by title or artist", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Find songs to add"), { target: { value: "gam" } });
    expect(screen.getByRole("checkbox", { name: "Gamma — A" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Alpha — A" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find songs to add"), { target: { value: "zed" } });
    expect(screen.getByRole("checkbox", { name: "Gamma — A" })).toBeInTheDocument();
  });

  it("adds the ticked songs in the order they were ticked", () => {
    const { onAdd } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma — A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Delta — A" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 songs" }));
    expect(onAdd).toHaveBeenCalledWith(["s3", "s4"]);
  });

  it("keeps a ticked song ticked after the search text changes", () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma — A" }));
    fireEvent.change(screen.getByLabelText("Find songs to add"), { target: { value: "alp" } });
    expect(screen.getByRole("button", { name: "Add 1 song" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Find songs to add"), { target: { value: "" } });
    expect(screen.getByRole("checkbox", { name: "Gamma — A" })).toBeChecked();
  });

  it("is disabled when nothing is ticked", () => {
    setup();
    expect(screen.getByRole("button", { name: "Add songs" })).toBeDisabled();
  });

  it("is disabled while busy", () => {
    setup({ busy: true });
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma — A" }));
    expect(screen.getByRole("button", { name: "Add 1 song" })).toBeDisabled();
  });

  it("clears the selection and the search after adding", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Find songs to add"), { target: { value: "gam" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma — A" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 song" }));
    await waitFor(() => expect(screen.getByLabelText("Find songs to add")).toHaveValue(""));
    expect(screen.getByRole("checkbox", { name: "Gamma — A" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Add songs" })).toBeDisabled();
  });

  it("keeps a song ticked while the save was running", async () => {
    let finish!: (ok: boolean) => void;
    const onAdd = vi.fn(() => new Promise<boolean>((r) => (finish = r)));
    render(<AddSongsPicker songs={songs} busy={false} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma — A" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 song" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Delta — A" }));
    finish(true);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Gamma — A" })).not.toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Delta — A" })).toBeChecked();
  });

  it("keeps the selection and the search when the save fails", async () => {
    const { onAdd } = setup({ saved: false });
    fireEvent.change(screen.getByLabelText("Find songs to add"), { target: { value: "gam" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma — A" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 song" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.getByLabelText("Find songs to add")).toHaveValue("gam");
    expect(screen.getByRole("checkbox", { name: "Gamma — A" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Add 1 song" })).toBeEnabled();
  });

  it("says so when every song is already in the setlist", () => {
    render(<AddSongsPicker songs={[]} busy={false} onAdd={async () => true} />);
    expect(screen.getByText("Every song is already in the setlist.")).toBeInTheDocument();
  });
});
