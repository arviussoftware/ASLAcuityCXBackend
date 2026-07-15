class MappedFormWithInteraction {
  constructor(
    id,
    formId,
    UniqueId,
    interactionId,
    formName,
    fromDescription,
    fromAssignBy,
    assignationId,
    fromAssignDate,
    evulationStatus,
    evulationStatusStr,
    evulationBy,
    evulationById,
    evulationDate,
    spentTimeonEvulation
  ) {
    this.id = id;
    this.formId = formId;
    this.UniqueId = UniqueId;
    this.interactionId = interactionId;
    this.formName = formName;
    this.fromDescription = fromDescription;
    this.fromAssignBy = fromAssignBy;
    this.assignationId = assignationId;
    this.fromAssignDate = fromAssignDate;
    this.evulationStatus = evulationStatus;
    this.evulationStatusStr = evulationStatusStr;
    this.evulationBy = evulationBy;
    this.evulationById = evulationById;
    this.evulationDate = evulationDate;
    this.spentTimeonEvulation = spentTimeonEvulation;
  }
}

async function setMappedFormWithInteraction(recordset) {
  const mappedformwithinteractionwise = await recordset.map(
    (a) =>
      new MappedFormWithInteraction(
        a.id,
        a.formId,
        a.UniqueId,
        a.interactionId,
        a.formName,
        a.fromDescription,
        a.fromAssignBy,
        a.assignationId,
        a.fromAssignDate,
        a.evulationStatus,
        a.evulationStatusStr,
        a.evulationBy,
        a.evulationById,
        a.evulationDate,
        a.spentTimeonEvulation
      )
  );
  return mappedformwithinteractionwise;
}

export { setMappedFormWithInteraction };
export default MappedFormWithInteraction;
