// constants/privileges.js
// Source: [QM_DB_New].[dbo].[TblMst_Privileges]
export const MODULES = {
  DASHBOARD:               1,
  USER_MANAGEMENT:         2,
  AGENT_ORG:               4,
  FORM_DESIGNER:           5,
  INTERACTION:             6,
  ROLE_MANAGEMENT:         7,
  ORGANIZATION:            8,
  REPORTS:                 10,
  ORGANIZATION_FORM_MAPPING: 9,
  INTEGRATION:   11,
};

export const PRIVILEGES = {
  VIEW:                    1,
  CREATE:                  2,
  EDIT:                    3,
  DOWNLOAD_EXCEL:          4,
  DELETE:                  5,
  PUBLISH_FORM:            7,
  EVALUATE_FORM:           8,
  VIEW_SUBMITTED_FORM:     9,
  CREATE_EDIT_FORM:        10,
  NONE:                    11,
  CREATE_PRIVILEGES:       12,
  PLAY_AUDIO:              13,
  DOWNLOAD_CSV:            14,
  DOWNLOAD_PDF:            15,
  COPY_FORM:               16,
  HIDE_UNHIDE_FORM:        17,
  STAGED_FORM:             18,
  UNSTAGED_FORM:           19,
  LINK_FORM_ORG:           20,
  USER_MANAGEMENT:         21,
  FORMS:                   22,
  INTERACTION:             23,
  AGENT_DASHBOARD:         24,
  DEASSOCIATE_ORG:         25,
  MY_EVALUATION:           26,
  ORG_EVALUATION:          27,
  SOURCE_ACCESS:           29,
  BULK_AUDIO_DOWNLOAD:     29,
  TRANSCRIPTION:           30,
  EXPORT:                  31,
  CREATE_ANNOTATION:       32,
  VIEW_ANNOTATION:         33,
  EDIT_ANNOTATION:         34,
  DELETE_ANNOTATION:       35,
};

// Table names — centralised so a rename only needs one change
export const TABLES = {
  ANNOTATION:  "[dbo].[TblMst_AnnotationTable]",
  METADATA:    "[dbo].[TblMst_Metadata]",
};
