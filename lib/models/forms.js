class FormsModel {
  constructor(
    id,
    formName,
    formDescription,
    formJson,
    Status,
    Modifydate,
    UniqueId,
    Creationby,
    Modifyby,
    Version,
    baselineScore,
    interactiontype,
    InteractionTypeName,
    Max_score,
  ) {
    this.formId = id;
    this.formName = formName;
    this.formDescription = formDescription;
    this.formJson = formJson;
    this.Status = Status;
    this.Modifydate = Modifydate;
    this.UniqueId = UniqueId;
    this.Creationby = Creationby;
    this.Modifyby = Modifyby;
    this.Version = Version;
    this.baselineScore = baselineScore;
    this.interactiontype = interactiontype;
    this.InteractionTypeName = InteractionTypeName;
    this.Max_score = Max_score;
  }
}

export default FormsModel;
