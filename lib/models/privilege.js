export class Privilege {
  constructor(id, name, moduleId = null) {
    this.id = id;
    this.name = name;
    this.moduleId = moduleId;
  }
}
