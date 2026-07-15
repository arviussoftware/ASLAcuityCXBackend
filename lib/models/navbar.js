import { mapRows, pickFirst } from "@/lib/models/_shared";

export function setNavbarModuleModel(rows) {
  return mapRows(rows, (row) => ({
    id: pickFirst(row, ["ID", "id"]),
    moduleName: pickFirst(row, ["ModuleName", "moduleName", "Name", "name"]),
    path: pickFirst(row, ["Path", "path", "Route", "route"]),
    redirectPath: pickFirst(row, ["RedirectPath", "redirectPath", "Path", "path", "Route", "route"]),
    menuSequenceNo: pickFirst(row, ["MenuSequenceNo", "menuSequenceNo"]),
    icon: pickFirst(row, ["Icon", "icon"]),
    // Capitalized casing to ensure compatibility across all code references
    ID: pickFirst(row, ["ID", "id"]),
    ModuleName: pickFirst(row, ["ModuleName", "moduleName", "Name", "name"]),
    Path: pickFirst(row, ["Path", "path", "Route", "route"]),
    RedirectPath: pickFirst(row, ["RedirectPath", "redirectPath", "Path", "path", "Route", "route"]),
    MenuSequenceNo: pickFirst(row, ["MenuSequenceNo", "menuSequenceNo"]),
    Icon: pickFirst(row, ["Icon", "icon"]),
    ...row,
  }));
}
