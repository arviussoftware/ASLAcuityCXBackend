export default class OrganizationModel {
  constructor(id, name, description, parentId, children = [], isActive = true) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.parentId = parentId;
    this.children = children;
    this.isActive = isActive;
  }
}
