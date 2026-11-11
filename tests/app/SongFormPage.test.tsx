import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { markupFromPlainText } from "../../src/shared/sheet";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return {
    ...actual,
    api: { importSong: vi.fn(), createSong: vi.fn(), updateSong: vi.fn(), getSong: vi.fn() },
  };
});

import { api, ApiError } from "../../src/app/api";
import SongFormPage from "../../src/app/pages/SongFormPage";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function renderForm() {
  return render(
    <MemoryRouter initialEntries={["/songs/new"]}>
      <Routes>
        <Route path="/songs/new" element={<SongFormPage />} />
        <Route path="/songs/:id" element={<div>song page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(mocked).forEach((f) => f.mockReset());
});

describe("SongFormPage", () => {
  it("imports from a link and fills the form with a preview", async () => {
    mocked.importSong.mockResolvedValue({
      title: "Wonderwall",
      artist: "Oasis",
      sourceUrl: "https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-1",
      originalKey: "Em",
      capo: 2,
      content: "[ch]Em7[/ch]Today is gonna be the day",
    });
    renderForm();
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Wonderwall"));
    expect(screen.getByLabelText("Artist")).toHaveValue("Oasis");
    expect(screen.getByLabelText("Original key")).toHaveValue("Em");
    expect(screen.getByTestId("preview")).toHaveTextContent("Today is gonna be the day");
  });

  it("shows the server message, reveals the paste box and keeps the link when import fails", async () => {
    mocked.importSong.mockRejectedValue(new ApiError(422, "Couldn't read that page. Paste the chords instead."));
    mocked.createSong.mockResolvedValue({ id: "s1" });
    renderForm();
    const link = "https://tabs.ultimate-guitar.com/tab/x/y-chords-9";
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: link } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Couldn't read that page. Paste the chords instead.")).toBeInTheDocument();
    expect(screen.getByLabelText("Chords")).toBeVisible();
    expect(screen.getByLabelText("Link")).toHaveValue(link);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Original key"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Chords"), { target: { value: "G\nHello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.createSong).toHaveBeenCalled());
    expect(mocked.createSong.mock.calls[0][0].sourceUrl).toBe(link);
  });

  it("saves pasted text as markup, defaults band key, and disables Save until title and key are set", async () => {
    mocked.createSong.mockResolvedValue({ id: "s2" });
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Paste chords" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    const text = "G       C\nHello there";
    fireEvent.change(screen.getByLabelText("Chords"), { target: { value: text } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Hello" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Original key"), { target: { value: "G" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(mocked.createSong).toHaveBeenCalledTimes(1));
    const sent = mocked.createSong.mock.calls[0][0];
    expect(sent.content).toBe(markupFromPlainText(text));
    expect(sent.bandKey).toBe("G");
    expect(sent.originalKey).toBe("G");
    expect(sent.sourceUrl).toBeNull();
  });
});
