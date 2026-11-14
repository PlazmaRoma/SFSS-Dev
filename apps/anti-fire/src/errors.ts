import { ApiError } from "@sfss/client";
import { serviceText, tr } from "./lang";

/** Текст для человека: причина от сервиса, а если сети нет, то так и сказать. */
export const errorText = (error: unknown) =>
  error instanceof ApiError && error.detail
    ? serviceText(error.detail)
    : error instanceof Error && error.name !== "AbortError" && !(error instanceof TypeError)
      ? serviceText(error.message)
      : tr("noReply");
