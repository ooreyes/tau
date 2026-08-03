// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsBridge = vi.hoisted(() => ({
  pickModelLibraryFile: vi.fn(),
}));
const installedApi = vi.hoisted(() => ({
  discoverInstalledLtspiceLibrary: vi.fn(),
  readInstalledLtspiceModel: vi.fn(),
}));

vi.mock("../project/fsBridge", () => fsBridge);
vi.mock("../project/installedLtspiceLibrary", () => installedApi);

import { ModelLibrariesDialog } from "./ModelLibrariesDialog";
import { useSchematic } from "../store/useSchematic";

afterEach(() => cleanup());
beforeEach(() => {
  fsBridge.pickModelLibraryFile.mockReset();
  installedApi.discoverInstalledLtspiceLibrary.mockReset();
  installedApi.readInstalledLtspiceModel.mockReset();
  useSchematic.setState({ userModelLibraries: [], past: [], future: [] });
});

describe("ModelLibrariesDialog", () => {
  it("renders the empty state when nothing is attached", () => {
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole("heading", { name: "Model libraries" })).toBeTruthy();
    expect(screen.getByText(/No model files are attached yet/)).toBeTruthy();
  });

  it("attaches a picked file", async () => {
    fsBridge.pickModelLibraryFile.mockResolvedValue({ name: "opamps.lib", text: ".subckt OPX 1 2 3\n.ends\n" });
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Attach model file..." }));

    await waitFor(() => expect(useSchematic.getState().userModelLibraries).toEqual([
      { name: "opamps.lib", text: ".subckt OPX 1 2 3\n.ends\n" },
    ]));
    expect(await screen.findByText("opamps.lib")).toBeTruthy();
  });

  it("attaches nothing when the picker is cancelled", async () => {
    fsBridge.pickModelLibraryFile.mockResolvedValue(null);
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Attach model file..." }));

    await waitFor(() => expect(fsBridge.pickModelLibraryFile).toHaveBeenCalledTimes(1));
    expect(useSchematic.getState().userModelLibraries).toEqual([]);
  });

  it("removes an attachment", async () => {
    useSchematic.getState().attachModelLibrary({ name: "diodes.lib", text: "* diodes" });
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove diodes.lib" }));

    expect(useSchematic.getState().userModelLibraries).toEqual([]);
  });

  it("shows an inline error for a new manual file at the attachment cap", async () => {
    useSchematic.setState({
      userModelLibraries: Array.from({ length: 64 }, (_, i) => ({ name: `lib-${i}.lib`, text: "* x" })),
    });
    fsBridge.pickModelLibraryFile.mockResolvedValue({ name: "one-too-many.lib", text: "* extra" });
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Attach model file..." }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Tau supports up to 64 attached model files.",
    );
    expect(fsBridge.pickModelLibraryFile).toHaveBeenCalledTimes(1);
  });

  it("surfaces a thrown picker error inline", async () => {
    fsBridge.pickModelLibraryFile.mockRejectedValue(new Error("Attaching model files requires the Tau desktop app or a browser with file access."));
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Attach model file..." }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Attaching model files requires the Tau desktop app or a browser with file access.",
    );
    expect(useSchematic.getState().userModelLibraries).toEqual([]);
  });

  it("discovers the user-owned installed LTspice library and attaches one selected model", async () => {
    installedApi.discoverInstalledLtspiceLibrary.mockResolvedValue({
      root: "/Users/test/Library/Application Support/LTspice/lib",
      files: [
        { id: "sub/UniversalOpAmp4.lib", name: "UniversalOpAmp4.lib", category: "sub", bytes: 2048 },
        { id: "cmp/standard.mos", name: "standard.mos", category: "cmp", bytes: 4096 },
      ],
    });
    installedApi.readInstalledLtspiceModel.mockResolvedValue({
      name: "UniversalOpAmp4.lib",
      text: ".subckt UniversalOpAmp4 1 2 3 4 5\n.ends UniversalOpAmp4\n",
    });
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Find installed library" }));
    expect(await screen.findByText("2 attachable text-model files found.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search installed LTspice models"), { target: { value: "universal" } });
    expect(screen.queryByText("standard.mos")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Attach installed model sub/UniversalOpAmp4.lib" }));

    await waitFor(() => expect(useSchematic.getState().userModelLibraries).toEqual([{
      name: "UniversalOpAmp4.lib",
      text: ".subckt UniversalOpAmp4 1 2 3 4 5\n.ends UniversalOpAmp4\n",
    }]));
    expect(screen.getByRole("button", { name: "Attach installed model sub/UniversalOpAmp4.lib" })).toHaveProperty("disabled", true);
  });

  it("surfaces an encrypted installed model refusal without attaching it", async () => {
    installedApi.discoverInstalledLtspiceLibrary.mockResolvedValue({
      root: "/Users/test/Library/Application Support/LTspice/lib",
      files: [{ id: "sub/encrypted.sub", name: "encrypted.sub", category: "sub", bytes: 100 }],
    });
    installedApi.readInstalledLtspiceModel.mockRejectedValue(new Error(
      "That LTspice model is binary or encrypted and cannot be attached as SPICE text.",
    ));
    render(<ModelLibrariesDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Find installed library" }));
    fireEvent.click(await screen.findByRole("button", { name: "Attach installed model sub/encrypted.sub" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "That LTspice model is binary or encrypted and cannot be attached as SPICE text.",
    );
    expect(useSchematic.getState().userModelLibraries).toEqual([]);
  });
});
