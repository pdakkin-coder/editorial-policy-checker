import { ThemeProvider } from "./components/ThemeProvider";
import Workbench from "./pages/Workbench";
import { Toaster } from "./components/ui/toaster";

export default function App() {
  return (
    <ThemeProvider>
      <Workbench />
      <Toaster />
    </ThemeProvider>
  );
}
