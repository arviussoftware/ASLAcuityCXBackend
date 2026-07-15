class ExtensionDDL {
  constructor(extension, extensionValue) {
    this.extension = extension;
    this.extensionValue = extensionValue;
  }
}

async function setExtenion(recordset) {
  const extenions = recordset.map(
    (e) => new ExtensionDDL(e.extension, e.extensionValue)
  );
  return extenions;
}

export { setExtenion };
export default ExtensionDDL;
