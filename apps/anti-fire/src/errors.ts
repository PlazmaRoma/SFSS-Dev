import { ApiError } from "@sfss/client";
import { serviceText, tr } from "./lang";

export const errorText = (error: unknown) =>
  error instanceof ApiError && error.detail
    ? serviceText(error.detail)
    : error instanceof Error && error.name !== "AbortError" && !(error instanceof TypeError)
      ? serviceText(error.message)
      : tr("noReply");
