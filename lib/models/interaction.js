class InteractionsModel {
  constructor(
    id,
    callId,
    ucid,
    ani,
    extension,
    audioStartTime,
    audioEndTime,
    personalName,
    agentId,
    agent,
    audioModuleNo,
    audioChannelNo,
    localStartTime,
    localEndTime,
    direction,
    noOfHolds,
    totalHoldTime,
    pbxLoginId,
    duration,
    dnis,
    screenExists,
    screenModule,
    switchId,
    switchCallId,
    switchName,
    fileLocation,
    fileSourceType,
    s3StorageClass,
    sid,
    organizationId,
    organizationName,
    userId,
    user_full_name,
    evaluation_date,
    form_name,
    FormUniqueId,
    EvaluationCount,
    transcriptionfilepath,
    transcription_source_type,
    Platformid,
    appid,
    transcription_status
    //formAppliedStatus
    // filterField = null,
    // filterValue = null
  ) {
    this.id = id; // Unique identifier for the interaction
    this.callId = callId; // ID of the call
    this.ucid = ucid; // Unique Call Identifier
    this.ani = ani; // Automatic Number Identification
    this.extension = extension; // Call extension
    this.audioStartTime = audioStartTime; // Start time of the audio recording
    this.audioEndTime = audioEndTime; // End time of the audio recording
    this.personalName = personalName; // Name associated with the call
    this.agentId = agentId; // Agent Id handling the interaction
    this.agent = agent;
    this.audioModuleNo = audioModuleNo;
    this.audioChannelNo = audioChannelNo;
    this.localStartTime = localStartTime;
    this.localEndTime = localEndTime;
    this.direction = direction;
    this.noOfHolds = noOfHolds;
    this.totalHoldTime = totalHoldTime;
    this.pbxLoginId = pbxLoginId;
    this.duration = duration;
    this.dnis = dnis;
    this.screenExists = screenExists;
    this.screenModule = screenModule;
    this.switchId = switchId;
    this.switchCallId = switchCallId;
    this.switchName = switchName;
    this.fileLocation = fileLocation;
    this.fileSourceType = fileSourceType;
    this.s3StorageClass = s3StorageClass;
    this.sid = sid;
    this.organizationId = organizationId;
    this.organizationName = organizationName;
    this.userId = userId;
    this.user_full_name = user_full_name;
    this.evaluation_date = evaluation_date;
    this.form_name = form_name;
    this.FormUniqueId = FormUniqueId;
    this.EvaluationCount = EvaluationCount;
    this.transcriptionfilepath = transcriptionfilepath;
    this.transcription_source_type = transcription_source_type;
    this.Platformid = Platformid ?? null;
    this.appid      = appid      ?? null;
    this.transcription_status = transcription_status ?? null;
    //this.formAppliedStatus = formAppliedStatus; // Status of the form applied
    // this.filterField = filterField; // Additional filter field if needed
    // this.filterValue = filterValue; // Value for the filter field
  }
}

async function setInteractions(recordset) {
  const interactions = recordset.map(
    (i) =>
      new InteractionsModel(
        i.id ?? i.interactionId ?? i.interaction_id,
        i.callId ?? i.call_id,
        i.ucid,
        i.ani,
        i.extension,
        i.audioStartTime ?? i.audio_start_time,
        i.audioEndTime ?? i.audio_end_time,
        i.personalName ?? i.personal_name,
        i.agentId ?? i.agent_id,
        i.agent ?? i.agentName ?? i.agent_name,
        i.audioModuleNo ?? i.audio_module_no,
        i.audioChannelNo ?? i.audio_ch_no ?? i.audioChannelNo,
        i.localStartTime ?? i.local_start_time,
        i.localEndTime ?? i.local_end_time,
        i.direction,
        i.noOfHolds ?? i.number_of_holds ?? i.no_of_holds,
        i.totalHoldTime ?? i.total_hold_time,
        i.pbxLoginId ?? i.pbx_login_id,
        i.duration,
        i.dnis ?? i.dnisCode ?? i.dnis_code,
        i.screenExists ?? i.screens_exists ?? i.screen_exists,
        i.screenModule ?? i.screens_module ?? i.screen_module,
        i.switchId ?? i.switch_id,
        i.switchCallId ?? i.switchCallid ?? i.switch_call_id,
        i.switchName ?? i.switch_name,
        i.fileLocation ?? i.file_location ?? i.filepath,
        i.fileSourceType ?? i.file_source_type,
        i.s3StorageClass ?? i.s3_storage_class,
        i.sid,
        i.organizationId ?? i.OrganizationID ?? i.organization_id,
        i.organizationName ?? i.org_name ?? i.organization_name,
        i.userId ?? i.user_id,
        i.user_full_name ?? i.user_name ?? i.user_fullname,
        i.evaluation_date ?? i.evaluation_date,
        i.form_name ?? i.form_name,
        i.FormUniqueId ?? i.form_unique_id,
        i.EvaluationCount ?? i.evaluation_count,
        i.transcriptionfilepath ?? i.transcription_file_path,
        i.transcription_source_type ?? null,
        i.Platformid ?? i.platformId ?? i.platform_id ?? null,
        i.appid ?? i.appId ?? i.app_id ?? null,
        i.transcription_status === 1 || i.transcription_status === "1" ? "PROCESSING"
          : i.transcription_status === 2 || i.transcription_status === "2" ? "COMPLETED"
          : i.transcription_status === 3 || i.transcription_status === "3" ? "FAILED"
          : i.transcription_status ?? null
      )
  );
  return interactions;
}

export { setInteractions };
export default InteractionsModel;
