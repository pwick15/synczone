import { Home } from "./pages/Home";
import { MeetingPage } from "./pages/MeetingPage";
import { NotFound, SessionPage } from "./pages/SessionPage";
import { usePath } from "./router";

export function App() {
  const path = usePath();
  const meeting = path.match(/^\/s\/([\w]+)\/m\/([\w]+)\/?$/);
  if (meeting) return <MeetingPage key={path} sid={meeting[1]} mid={meeting[2]} />;
  const session = path.match(/^\/s\/([\w]+)\/?$/);
  if (session) return <SessionPage key={path} sid={session[1]} />;
  if (path === "/") return <Home />;
  return <NotFound what="page" />;
}
