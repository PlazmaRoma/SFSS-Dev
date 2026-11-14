import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Program from "./Program";

document.body.classList.add("is-program");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Program />
  </StrictMode>,
);
