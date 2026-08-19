import { LogsIcon } from "lucide-react";

import { Markdown } from "~/components/deer-flow/markdown";

import changlog from "./CHANGELOG.md";
import type { Tab } from "./types";

export const ChanglogTab: Tab = () => {
  
  const changlogContent = changlog;

  return <Markdown>{changlogContent}</Markdown>;
};
ChanglogTab.icon = LogsIcon;
ChanglogTab.displayName = "Changelog";
