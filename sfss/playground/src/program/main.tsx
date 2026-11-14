import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Program from "./Program";

// Программа живёт на чистом чёрном: звёздный фон лендинга здесь только
// мешал бы читать цифры.
document.body.classList.add("is-program");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Program />
  </StrictMode>,
);
