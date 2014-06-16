angular.module("ct.ui.router.extras", [ 'ui.router' ]);

$StickyStateProvider.$inject = [ '$stateProvider' ];
function $StickyStateProvider($stateProvider) {
  // Holds all the states which are inactivated.  Inactivated states can be either sticky states, or descendants of sticky states.
  var inactiveStates = {}; // state.name -> (state)
  var stickyStates = {}; // state.name -> true
  var $state;

  // Called by $stateProvider.registerState();
  // registers a sticky state with $stickyStateProvider
  this.registerStickyState = function (state) {
    stickyStates[state.name] = state;
    console.log("Registered sticky state: ", state);
  };

  this.$get = [ '$rootScope', '$state', '$injector', function ($rootScope, $state, $injector) {
    // Each inactive states is either a sticky state, or a child of a sticky state.
    // This function finds the closest ancestor sticky state, then find that state's parent.
    // Map all inactive states to their closest parent-to-sticky state.
    function mapInactives() {
      var mappedStates = {};
      for (var name in inactiveStates) {
        var state = inactiveStates[name];
        var parParents = getStickyStateStack(state);
        for (var i = 0; i < parParents.length; i++) {
          var parent = parParents[i].parent;
          mappedStates[parent.name] = mappedStates[parent.name] || [];
          mappedStates[parent.name].push(state);
        }
      }
      return mappedStates;
    }

    // Given a state, returns all ancestor states which are sticky.
    // Walks up the view's state's ancestry tree and locates each ancestor state which is marked as sticky.
    // Returns an array populated with only those ancestor sticky states.
    function getStickyStateStack(state) {
      var stack = [];
      if (!state) return stack;
      do {
        if (state.sticky) stack.push(state);
        state = state.parent;
      } while (state);
      stack.reverse();
      return stack;
    }

    // Used by processTransition to determine if what kind of sticky state transition this is.
    // returns { from: (bool), to: (bool) }
    function getStickyTransitionType(fromPath, toPath, keep) {
      if (fromPath[keep] === toPath[keep]) return { from: false, to: false };
      var stickyFromState = keep < fromPath.length && fromPath[keep].self.sticky;
      var stickyToState = keep < toPath.length && toPath[keep].self.sticky;
      return { from: stickyFromState, to: stickyToState };
    }

    // Returns a sticky transition type necessary to enter the state.
    // Transition can be: reactivate, updateStateParams, or enter

    // Note: if a state is being reactivated but params dont match, we treat
    // it as a Exit/Enter, thus the special "updateStateParams" transition.
    // If a parent inactivated state has "updateStateParams" transition type, then
    // all descendant states must also be exit/entered, thus the first line of this function.
    function getEnterTransition(state, stateParams, ancestorParamsChanged) {
      if (ancestorParamsChanged) return "updateStateParams";
      var inactiveState = inactiveStates[state.self.name];
      if (!inactiveState) return "enter";
      if (inactiveState.locals == null || inactiveState.locals.globals == null) debugger;
      var paramsMatch = equalForKeys(stateParams, inactiveState.locals.globals.$stateParams, state.ownParams);
      // console.log("getEnterTransition: " + state.name + (paramsMatch ? ": reactivate" : ": updateStateParams"));
      return paramsMatch ? "reactivate" : "updateStateParams";
    }

    // Given a state and (optional) stateParams, returns the inactivated state from the inactive sticky state registry.
    function getInactivatedState(state, stateParams) {
      var inactiveState = inactiveStates[state.name];
      if (!inactiveState) return null;
      if (!stateParams) return inactiveState;
      var paramsMatch = equalForKeys(stateParams, inactiveState.locals.globals.$stateParams, state.ownParams);
      return paramsMatch ? inactiveState : null;
    }

    // Duplicates logic in $state.transitionTo, primarily to find the pivot state (i.e., the "keep" value)
    function equalForKeys(a, b, keys) {
      if (!keys) {
        keys = [];
        for (var n in a) keys.push(n); // Used instead of Object.keys() for IE8 compatibility
      }

      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (a[k] != b[k]) return false; // Not '===', values aren't necessarily normalized
      }
      return true;
    }

    var stickySupport = {
      getInactiveStates: function () {
        var states = [];
        angular.forEach(inactiveStates, function (state) {
          states.push(state);
        });
        return states;
      },
      getInactiveStatesByParent: function () {
        return mapInactives();
      },
      // Main API for $stickyState, used by $state.
      // Processes a potential transition, returns an object with the following attributes:
      // {
      //    inactives: Array of all states which will be inactive if the transition is completed. (both previously and newly inactivated)
      //    enter: Enter transition type for all added states.  This is a sticky array to "toStates" array in $state.transitionTo.
      //    exit: Exit transition type for all removed states.  This is a sticky array to "fromStates" array in $state.transitionTo.
      // }
      processTransition: function (transition) {
        // This object is returned
        var result = { inactives: [], enter: [], exit: [], keep: 0 };
        var fromPath = transition.fromState.path,
            fromParams = transition.fromParams,
            toPath = transition.toState.path,
            toParams = transition.toParams;
        var keep = 0, state = toPath[keep];

        while (state && state === fromPath[keep] && equalForKeys(toParams, fromParams, state.ownParams)) {
          state = toPath[++keep];
          if (state != null && state.ownParams == null)
            debugger;
        }

//                    if (keep <= 0) return result;
        result.keep = keep;

        var idx, deepestUpdatedParams, deepestReactivate, reactivatedStatesByName = {}, pType = getStickyTransitionType(fromPath, toPath, keep);
        var ancestorUpdated = false; // When ancestor params change, treat reactivation as exit/enter

        // Calculate the "enter" transitions for new states in toPath
        // Enter transitions will be either "enter", "reactivate", or "updateStateParams" where
        //   enter: full resolve, no special logic
        //   reactivate: use previous locals
        //   updateStateParams: like 'enter', except exit the inactive state before entering it.
        for (idx = keep; idx < toPath.length; idx++) {
          var enterTrans = !pType.to ? "enter" : getEnterTransition(toPath[idx], transition.toParams, ancestorUpdated);
          ancestorUpdated = (ancestorUpdated || enterTrans == 'updateStateParams');
          result.enter[idx] = enterTrans;
          // If we're reactivating a state, make a note of it, so we can remove that state from the "inactive" list
          if (enterTrans == 'reactivate')
            deepestReactivate = reactivatedStatesByName[toPath[idx].name] = toPath[idx];
          if (enterTrans == 'updateStateParams')
            deepestUpdatedParams = toPath[idx];
        }
        deepestReactivate = deepestReactivate ? deepestReactivate.self.name + "." : "";
        deepestUpdatedParams = deepestUpdatedParams ? deepestUpdatedParams.self.name + "." : "";

        // Inactive states, before the transition is processed, mapped to the parent to the sticky state.
        var inactivesByParent = mapInactives();

        // Locate currently and newly inactive states (at pivot and above) and store them in the output array 'inactives'.
        for (idx = 0; idx < keep; idx++) {
          var inactiveChildren = inactivesByParent[fromPath[idx].self.name];
          for (var i = 0; inactiveChildren && i < inactiveChildren.length; i++) {
            var child = inactiveChildren[i];
            // Don't organize state as inactive if we're about to reactivate it.
            if (!reactivatedStatesByName[child.name] &&
                (!deepestReactivate || (child.self.name.indexOf(deepestReactivate) !== 0)) &&
                (!deepestUpdatedParams || (child.self.name.indexOf(deepestUpdatedParams) !== 0)))
              result.inactives.push(child);
          }
        }

        // Calculate the "exit" transition for states not kept, in fromPath.
        // Exit transition can be one of:
        //   exit: standard state exit logic
        //   inactivate: register state as an inactive state
        for (idx = keep; idx < fromPath.length; idx++) {
          var exitTrans = "exit";
          if (pType.from) {
            // State is being inactivated, note this in result.inactives array
            result.inactives.push(fromPath[idx]);
            exitTrans = "inactivate";
          }
          result.exit[idx] = exitTrans;
        }

//      console.log("processTransition: " , result);
        return result;
      },

      // Adds a state to the inactivated sticky state registry.
      stateInactivated: function (state) {
        // Keep locals around.
        inactiveStates[state.self.name] = state;
        // Notify states they are being Inactivated (i.e., a different
        // sticky state tree is now active).
        if (state.self.onInactivate)
          $injector.invoke(state.self.onInactivate, state.self, state.locals.globals);
      },

      // Removes a previously inactivated state from the inactive sticky state registry
      stateReactivated: function (state) {
        if (inactiveStates[state.self.name]) {
          delete inactiveStates[state.self.name];
        }
        if (state.locals == null || state.locals.globals == null) debugger;
        if (state.self.onReactivate)
          $injector.invoke(state.self.onReactivate, state.self, state.locals.globals);
      },

      // Exits all inactivated descendant substates when the ancestor state is exited.
      // When transitionTo is exiting a state, this function is called with the state being exited.  It checks the
      // registry of inactivated states for descendants of the exited state and also exits those descendants.  It then
      // removes the locals and de-registers the state from the inactivated registry.
      stateExiting: function (exiting, exitQueue, onExit) {
        var substatePrefix = exiting.self.name + "."; // All descendant states will start with this prefix
        var exitingNames = {};
        angular.forEach(exitQueue, function (state) {
          exitingNames[state.self.name] = true;
        });
        for (var name in inactiveStates) {
          // TODO: Might need to run the inactivations in the proper depth-first order?
          if (!exitingNames[name] && name.indexOf(substatePrefix) === 0) { // inactivated state's name starts with the prefix.
            console.log("Exiting " + name + " because it's a substate of " + substatePrefix + " and wasn't found in ", exitingNames);
            var inactiveExiting = inactiveStates[name];
            if (inactiveExiting.self.onExit)
              $injector.invoke(inactiveExiting.self.onExit, inactiveExiting.self, inactiveExiting.locals.globals);
            inactiveExiting.locals = null;
            delete inactiveStates[name];
          }
        }
        if (onExit)
          $injector.invoke(onExit, exiting.self, exiting.locals.globals);
        exiting.locals = null;
        delete inactiveStates[exiting.self.name];
      },

      // Removes a previously inactivated state from the inactive sticky state registry
      stateEntering: function (entering, params, onEnter) {
        var inactivatedState = getInactivatedState(entering);
        if (inactivatedState && !getInactivatedState(entering, params)) {
          var savedLocals = entering.locals;
          this.stateExiting(inactivatedState);
          entering.locals = savedLocals;
        }

        if (onEnter)
          $injector.invoke(onEnter, entering.self, entering.locals.globals);
      }
    };

    return stickySupport;
  }];
}

angular.module("ct.ui.router.extras").provider("$stickyState", $StickyStateProvider);