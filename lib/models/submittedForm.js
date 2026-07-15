class SubmittedFormWithInteraction {
  constructor(
    id,
    formId,
    UniqueId,
    interactionId,
    formName,
    fromDescription,
    ansJson
  ) {
    this.id = id;
    this.formId = formId;
    this.UniqueId = UniqueId;
    this.interactionId = interactionId;
    this.formName = formName;
    this.fromDescription = fromDescription;
    this.ansJson = ansJson;
  }
}

async function setSubmittedFormWithInteraction(recordset) {
  const mappedformwithinteractionwise = await recordset.map(
    (a) =>
      new SubmittedFormWithInteraction(
        a.id,
        a.formId,
        a.UniqueId,
        a.interactionId,
        a.formName,
        a.fromDescription,
        a.ansJson
      )
  );
  return mappedformwithinteractionwise;
}

export { setSubmittedFormWithInteraction };
export default SubmittedFormWithInteraction;
