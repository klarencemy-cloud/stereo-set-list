import Metronome from "../components/Metronome";
import Tuner from "../components/Tuner";

export default function ToolsPage() {
  return (
    <main className="page tools-page">
      <h1>Tools</h1>
      <Tuner />
      <Metronome />
    </main>
  );
}
