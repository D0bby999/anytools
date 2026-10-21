import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { RefTable } from "~/components/doc/ref-table";
import { DateText } from "~/components/ui/date-text";
import { documentKind, StatusCell } from "~/components/knowledge/document-table";
import { linkHost, type MineDocument } from "~/lib/mine";

/**
 * Every file or every link of the learner's, in one table: the document (to
 * its reader), where it came from (a link's host), its knowledge base, its
 * kind, its status and when it changed. Newest first, from the loader.
 */
export function MineTable({ documents, kind, caption }: { documents: MineDocument[]; kind: "files" | "links"; caption: string }) {
  const { t } = useTranslation("common");
  const { t: tk } = useTranslation("knowledge");
  const link = "font-medium text-primary underline underline-offset-4 hover:text-primary-hover";

  const columns = [
    t("mine.table.document"),
    ...(kind === "links" ? [t("mine.table.source")] : []),
    t("mine.table.kb"),
    t("mine.table.kind"),
    t("mine.table.status"),
    t("mine.table.updated"),
  ];
  const rows = documents.map((doc) => [
    <Link key="doc" to={`/documents/${doc.id}`} className={link}>
      {doc.title}
    </Link>,
    ...(kind === "links"
      ? [
          doc.source_url ? (
            <a key="src" href={doc.source_url} target="_blank" rel="noreferrer noopener" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
              {linkHost(doc.source_url)}
              <span className="sr-only"> {t("mine.opensNewTab")}</span>
            </a>
          ) : (
            "–"
          ),
        ]
      : []),
    <Link key="kb" to={`/knowledge/${doc.kb_id}`} className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
      {doc.kb_name}
    </Link>,
    <span key="kind" className="whitespace-nowrap">
      {documentKind(doc, tk)}
    </span>,
    <StatusCell key="status" document={doc} />,
    <DateText key="date" iso={doc.updated_at} className="whitespace-nowrap" />,
  ]);

  return <RefTable columns={columns} rows={rows} caption={caption} rowHeaders={false} />;
}
