var _ = require('lodash'),
	async = require('async'),
	Arrow = require('arrow');

/**
 * Runs a composite method based on the provided parameters.
 * @param params
 */
exports.execComposite = function execComposite(params) {
	var self = this,
		arg = params.arg,
		next = params.next;

	if (_.isFunction(arg)) {
		next = arg;
		arg = undefined;
	}

	var joinMeta = params.Model.getMeta('left_join') || params.Model.getMeta('inner_join'),
		modelMetas = {},
		isInnerJoin = !params.Model.getMeta('left_join'),
		modelMap = {},
		joinedModels = [],
		instances = {};

	if (_.isArray(joinMeta)) {
		for (var i = 0; i < joinMeta.length; i++) {
			modelMetas[joinMeta[i].model] = joinMeta[i];
		}
	}
	else if (joinMeta) {
		modelMetas[joinMeta.model] = joinMeta;
	}

	for (var fieldName in params.Model.fields) {
		/* istanbul ignore else */
		if (params.Model.fields.hasOwnProperty(fieldName)) {
			var field = params.Model.fields[fieldName],
				modelName = field.model,
				modelMeta = modelMetas[modelName];

			// Check the model.
			if (!modelName) {
				continue;
			}

			var GrabbedModel = Arrow.getModel(modelName);
			if (!GrabbedModel) {
				return next(new Error('Unable to find model ' + modelName + '.'));
			}

			// Check the field.
			if (modelMeta) {
				if (params.isWrite && (arg.getChangedFields ? arg.getChangedFields() : arg)[fieldName]) {
					return next(new Error('API-354: Joined fields cannot be written to yet.'));
				}
				if (params.method === 'query' && self.containsKey(arg, fieldName, ['sel', 'unsel'])) {
					return next(new Error('API-354: Joined fields cannot be queried on yet.'));
				}
			}

			// Map the model.
			if (modelMap[modelName]) {
				continue;
			}
			modelMap[modelName] = true;
			if (modelMeta) {
				joinedModels.push({
					name: modelName,
					readonly: true,
					left_join: modelMeta.join_properties,
					multiple: field.type === 'array' || field.type === Array,
					fieldName: fieldName,
					limit: field.limit
				});
			}
			else {
				joinedModels.unshift({
					name: modelName
				});
			}
		}
	}

	async.each(joinedModels, function modelExecHandler(model, cb) {
		if (params.isWrite && model.readonly) {
			return cb();
		}
		if (model.left_join || !model.name) {
			return cb();
		}
		var fieldKey = self.fetchModelObjectFieldKey(params.Model, model),
			localArg = arg;
		if (localArg && fieldKey) {
			localArg = localArg[fieldKey] || (localArg.where && localArg.where[fieldKey]) || localArg;
			localArg = self.checkParse(localArg, false);
		}
		if (params.isWrite) {
			if (!localArg.getPrimaryKey) {
				// Object
				localArg = _.pick(localArg, _.keys(Arrow.getModel(model.name).fields));
			} else {
				// Instance - convert instance to their source model instance and map aliases.
				var SourceModel = Arrow.getModel(model.name);
				var instanceFields = {
					cleanFields: {},
					dirtyFields: {}
				};

				var allValues = localArg.values();
				var allDirtyFields = localArg.values(true);

				// Filter out instance fields not associated with this source model and unalias
				for (var valueKey in allValues) {
					if (!allValues.hasOwnProperty(valueKey)) {
						continue;
					}
					if (params.Model.fields[valueKey] && params.Model.fields[valueKey].model === model.name) {
						var name = params.Model.fields[valueKey].name || valueKey;
						if (allDirtyFields.hasOwnProperty(valueKey)) {
							instanceFields.dirtyFields[name] = allValues[valueKey];
						} else {
							instanceFields.cleanFields[name] = allValues[valueKey];
						}
					}
				}

				// Create a new instance with the fields.
				var inst = SourceModel.instance(instanceFields.cleanFields);
				inst.id = localArg.primaryKey;
				inst.set(instanceFields.dirtyFields);
				localArg = inst;
			}
		}

		self.execModelMethod(params.Model, model, params.method, localArg, function methodCallback(err, instance) {
			if (err) {
				cb(err);
			}
			else {
				instances[model.name] = instance;
				cb();
			}
		});
	}, function modelsDoneCallback(err) {
		if (err) {
			next(err);
		}
		else {
			self.runJoin(params.Model, params.isCollection, instances, joinedModels, isInnerJoin, next);
		}
	});

};
