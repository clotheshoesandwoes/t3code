import { createFileRoute } from "@tanstack/react-router";

import { LanesPage } from "../components/lanes/LanesPage";

export const Route = createFileRoute("/_chat/lanes")({
  component: LanesPage,
});
