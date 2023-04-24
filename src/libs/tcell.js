import { getConfig } from "src/libs/config";

export const initializeTCell = () => {
  const {
    tCell: { appId, apiKey },
  } = getConfig();
  const script = document.createElement("script");
  script.setAttribute("src", "https://us.jsagent.tcell.insight.rapid7.com/tcellagent.min.js");
  script.setAttribute("tcellappid", appId);
  script.setAttribute("tcellapikey", apiKey);
  document.head.appendChild(script);
};
