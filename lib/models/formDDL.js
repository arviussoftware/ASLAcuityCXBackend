import { mapRows, pickFirst } from "@/lib/models/_shared";

function mapForm(row) {
  return {
    id: pickFirst(row, ["Form_id", "FormId", "formId", "id", "ID"]),
    formName: pickFirst(row, ["form_name", "FormName", "name", "Name"]),
    status: pickFirst(row, ["Status", "status"]),
    selected: Boolean(pickFirst(row, ["selected", "Selected", "isSelected", "IsSelected"], false)),
    ...row,
  };
}

export function setAllFormInDDL(rows) {
  return mapRows(rows, mapForm);
}

export function setFormWithSelectedStatusInDDL(rows) {
  return mapRows(rows, mapForm);
}
