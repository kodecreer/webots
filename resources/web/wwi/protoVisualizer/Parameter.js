'use strict';

import {SFNode, stringifyType} from './Vrml.js';
import WbWorld from '../nodes/WbWorld.js';
import Node from './Node.js';

export default class Parameter {
  #type;
  #name;
  #value;
  #defaultValue;
  #isTemplateRegenerator;
  #parameterLinks;
  constructor(node, name, type, defaultValue, value, isTemplateRegenerator) {
    this.node = node; // node this parameter belongs to
    this.type = type;
    this.name = name;
    this.defaultValue = defaultValue;
    this.value = value;
    this.isTemplateRegenerator = isTemplateRegenerator;
    this.#parameterLinks = []; // list of other parameters to notify whenever this instance changes
  }

  get value() {
    return this.#value;
  }

  set value(v) {
    if (v.type() !== this.type)
      throw new Error('Type mismatch, setting ' + stringifyType(v.type()) + ' to ' + stringifyType(this.type) + ' parameter.');

    this.#value = v;
  }

  get defaultValue() {
    return this.#defaultValue;
  }

  set defaultValue(v) {
    if (v.type() !== this.type)
      throw new Error('Type mismatch, setting ' + stringifyType(v.type()) + ' to ' + stringifyType(this.type) + ' parameter.');

    this.#defaultValue = v;
  }

  get type() {
    return this.#type;
  }

  set type(type) {
    this.#type = type;
  }

  get name() {
    return this.#name;
  }

  set name(value) {
    this.#name = value;
  }

  get isTemplateRegenerator() {
    return this.#isTemplateRegenerator;
  }

  set isTemplateRegenerator(value) {
    this.#isTemplateRegenerator = value;
  }

  get parameterLinks() {
    return this.#parameterLinks;
  }

  resetParameterLinks() {
    this.#parameterLinks = [];
  }

  insertLink(parameter) {
    this.#parameterLinks.push(parameter);
  }

  // TODO: find better approach rather than propagating the view to subsequent parameters
  setValueFromJavaScript(view, v) {
    // notify linked parameters of the change
    console.log(this.name, ' has links: ', this.parameterLinks);
    for (const link of this.parameterLinks) {
      const newValue = (v !== null && v instanceof Node) ? v.clone() : v;
      console.log(this.name + ' change notifies ' + link.name);
      link.setValueFromJavaScript(view, newValue);
    }

    if (this.isTemplateRegenerator) {
      // update value on the structure side
      this.#value.setValueFromJavaScript(v);

      console.log('  > ' + this.name + ' is a template regenerator!');

      if (!this.node.isProto)
        throw new Error('Attempting to regenerate a base node.'); // TODO: can we reach this point anyway? if so, just return

      // note: only base-nodes write to x3d, so to know the ID of the node we need to delete, we need to navigate through the
      // value of the proto (or multiple times if it's a derived PROTO)
      const id = this.node.getBaseNode().id; // delete existing node (must be done prior to regeneration or the information is lost)
      view.x3dScene.processServerMessage(`delete: ${id.replace('n', '')}`);

      // regenerate and parse the body of the associated node
      this.node.parseBody(true);

      const x3d = new XMLSerializer().serializeToString(this.node.toX3d());
      view.x3dScene.loadObject('<nodes>' + x3d + '</nodes>');

      if (typeof this.onChange === 'function')
        this.onChange();
    } else {
      if (this.node.isProto) {
        // update value on the structure side
        this.#value.setValueFromJavaScript(v);
        return; // webotsJS needs to be notified of parameter changes only if the parameter belongs to a base-node, not PROTO
      }

      if (this.#value instanceof SFNode) {
        const baseNode = this.node.getBaseNode();
        if (this.#value.value !== null) {
          // delete existing node
          const p = baseNode.getParameterByName(this.name);
          const id = p.value.value.getBaseNode().id;

          view.x3dScene.processServerMessage(`delete: ${id.replace('n', '')}`);
          console.log('delete: ', id);
        }

        // update value on the structure side
        this.#value.setValueFromJavaScript(v);

        if (v !== null) {
          // get the parent id to insert the new node
          const parentId = baseNode.id.replace('n', ''); // view.x3dScene.parentId(id);
          console.log('parent node: ' + parentId);

          const x3d = new XMLSerializer().serializeToString(v.toX3d());
          console.log('in parent ', parentId, ' insert:' + x3d);
          view.x3dScene.loadObject('<nodes>' + x3d + '</nodes>', parentId);
        }
      } else {
        // update value on the structure side
        this.#value.setValueFromJavaScript(v);

        // update value on the webotsJS side
        const action = {};
        action['id'] = this.node.id;
        action[this.name] = this.value.toJson();
        console.log('setPose', action)
        view.x3dScene.applyPose(action);
      }
      view.x3dScene.render();
    }
  }

  isDefault() {
    if (typeof this.defaultValue === 'undefined' || typeof this.value === 'undefined')
      throw new Error('Cannot check default-ness, either "value" or "defaultValue" is undefined.');

    return this.value.equals(this.defaultValue);
  }

  clone() {
    const copy = new Parameter(this.node, this.name, this.type, this.defaultValue.clone(), this.value.clone(),
      this.isTemplateRegenerator);
    return copy;
  }
}

export {Parameter};
