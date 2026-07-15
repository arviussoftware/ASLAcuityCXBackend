export default class FormAnswersModel {
  constructor(interactionId, formId, assignationDate, assignationBy, sectionDetails, subsectionDetails, question, answer, finalScore) {
    this.interactionId = interactionId;
    this.formId = formId;
    this.assignationDate = assignationDate;
    this.assignationBy = assignationBy;
    this.sectionDetails = sectionDetails;
    this.subsectionDetails = subsectionDetails;
    this.question = question;
    this.answer = answer;
    this.finalScore = finalScore;
  }
}
