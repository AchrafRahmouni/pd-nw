"use strict";

var gui = require("nw.gui"); 
var pdgui = require("./pdgui.js");
var pd_menus = require("./pd_menus.js");

// Apply gui preset to this canvas
pdgui.skin.apply(this);

//var name = pdgui.last_loaded();
   
var l = pdgui.get_local_string;

console.log("my working dir is " + pdgui.get_pwd());
document.getElementById("saveDialog")
    .setAttribute("nwworkingdir", pdgui.get_pwd());
document.getElementById("fileDialog")
    .setAttribute("nwworkingdir", pdgui.get_pwd());
document.getElementById("fileDialog").setAttribute("accept",
    Object.keys(pdgui.pd_filetypes).toString());

var last_keydown = "";

// This could probably be in pdgui.js
function add_keymods(key, evt) {
    var shift = evt.shiftKey ? "Shift" : "";
    var ctrl = evt.ctrlKey ? "Ctrl" : "";
    return shift + ctrl + key;
}

function close_save_dialog() {
    document.getElementById("save_before_quit").close();
}

function text_to_fudi(text) {
    text = text.trim();
    text = text.replace(/(\$[0-9]+)/g, "\\$1");    // escape dollar signs
    text = text.replace(/(?!\\)(,|;)/g, " \\$1 "); // escape "," and ";"
    text = text.replace(/\{|\}/g, "");             // filter "{" and "}"
    text = text.replace(/\s+/g, " ");              // filter consecutive /s
    return text;
}

// Should probably be in pdgui.js
function encode_for_dialog(s) {
    s = s.replace(/\s/g, "+_");
    s = s.replace(/\$/g, "+d");
    s = s.replace(/;/g, "+s");
    s = s.replace(/,/g, "+c");
    s = s.replace(/\+/g, "++");
    s = "+" + s;
    return s;
}

// Super-simplistic guess at whether the string from the clipboard
// starts with Pd code. This is just meant as a convenience so that
// stuff in the copy buffer that obviously isn't Pd code doesn't get
// in the way when editing.
function might_be_a_pd_file(stuff_from_clipboard) {
    var text = stuff_from_clipboard.trim(),
        one = text.charAt(0),
        two = text.charAt(1);
    return (one === "#" && (two === "N" || two === "X"));
}

function permission_to_paste_from_external_clipboard() {
    return global.confirm(l("canvas.paste_clipboard_prompt"));
}

function nw_window_focus_callback() {
    // on OSX, update the menu on focus
    if (process.platform === "darwin") {
        nw_create_patch_window_menus(gui, window, name);
    }
}

// These three functions need to be inside canvas_events closure
function canvas_find_whole_word(elem) {
    canvas_events.match_words(elem.checked);
}

function canvas_find_blur() {
    canvas_events.normal();
}

function canvas_find_focus() {
    var state = canvas_events.get_state();
    canvas_events.search();
}

function cmd_or_ctrl_key(evt) {
    if (process.platform === "darwin") {
        return evt.metaKey;
    } else {
        return evt.ctrlKey;
    }
}

var canvas_events = (function() {
    var name,
        state,
        scalar_draggables = {}, // elements of a scalar which have the "drag" event enabled
        draggable_elem,         // last scalar we dragged
        last_draggable_x,       // last x coord for the element we're dragging
        last_draggable_y,       // last y 
        previous_state = "none", /* last state, excluding explicit 'none' */
        match_words_state = false,
        last_search_term = "",
        keydown_autorepeat = false,
        svg_view = document.getElementById("patchsvg").viewBox.baseVal,
        textbox = function () {
            return document.getElementById("new_object_textentry");
        },
        target_is_scrollbar = function(evt) {
            // Don't send the event to Pd if we click on the scrollbars.
            // This is a bit fragile because we're suppressing on
            // HTMLHtmlElement which is too broad...
            if (evt.target.constructor.name === "HTMLHtmlElement") {
                return 1;
            } else {
                return 0;
            }
        },
        events = {
            mousemove: function(evt) {
                //pdgui.post("x: " + evt.pageX + " y: " + evt.pageY +
                //    " modifier: " + (evt.shiftKey + (cmd_or_ctrl_key(evt) << 1)));
                pdgui.pdsend(name, "motion",
                    (evt.pageX + svg_view.x),
                    (evt.pageY + svg_view.y),
                    (evt.shiftKey + (cmd_or_ctrl_key(evt) << 1))
                );
                evt.stopPropagation();
                evt.preventDefault();
                return false;
            },
            mousedown: function(evt) {
                var target_id;
                if (target_is_scrollbar(evt)) {
                    return;
                } else if (evt.target.classList.contains("clickable_resize_handle")) {
                    // get id ("x123456etcgobj" without the "x" or "gobj")
                    target_id = "_h" +
                        evt.target.parentNode.id.slice(0,-4).slice(1);
                    last_draggable_x = evt.pageX + svg_view.x;
                    last_draggable_y = evt.pageY + svg_view.y;
                    pdgui.pdsend(target_id, "_click", 1,
                        (evt.pageX + svg_view.x),
                        (evt.pageY + svg_view.y));
                    canvas_events.iemgui_label_drag();
                    return;
                }
                // tk events (and, therefore, Pd evnets) are one greater
                // than html5...
                var b = evt.button + 1;
                var mod;
                // See if there are any draggable scalar shapes...
                if (Object.keys(scalar_draggables)) {
                    // if so, see if our target is one of them...
                    if (scalar_draggables[evt.target.id]) {
                        // then set some state and turn on the drag events
                        draggable_elem = evt.target;
                        last_draggable_x = evt.pageX;
                        last_draggable_y = evt.pageY;
                        canvas_events.scalar_drag();
                    }
                }
                // For some reason right-click sends a modifier value of "8",
                // and canvas_doclick in g_editor.c depends on that value to
                // do the right thing.  So let's hack...
                if (b === 3 || (process.platform === "darwin" && evt.ctrlKey)) {
                    // right-click
                    mod = 8;
                } else {
                    mod = (evt.shiftKey + (cmd_or_ctrl_key(evt) << 1)); 
                }
                pdgui.pdsend(name, "mouse",
                    (evt.pageX + svg_view.x),
                    (evt.pageY + svg_view.y),
                    b, mod
                );
                //evt.stopPropagation();
                //evt.preventDefault();
            },
            mouseup: function(evt) {
                //pdgui.post("mouseup: x: " +
                //    evt.pageX + " y: " + evt.pageY +
                //    " button: " + (evt.button + 1));
                pdgui.pdsend(name, "mouseup",
                    (evt.pageX + svg_view.x),
                    (evt.pageY + svg_view.y),
                    (evt.button + 1)
                );
                evt.stopPropagation();
                evt.preventDefault();
            },
            keydown: function(evt) {
                var key_code = evt.keyCode,
                    hack = null; // hack for unprintable ascii codes
                keydown_autorepeat = evt.repeat;
                switch(key_code) {
                    case 8:
                    case 9:
                    case 10:
                    case 27:
                    //case 32:
                    case 127: hack = key_code; break;
                    case 37: hack = add_keymods("Left", evt); break;
                    case 38: hack = add_keymods("Up", evt); break;
                    case 39: hack = add_keymods("Right", evt); break;
                    case 40: hack = add_keymods("Down", evt); break;
                    case 33: hack = add_keymods("Prior", evt); break;
                    case 34: hack = add_keymods("Next", evt); break;
                    case 35: hack = add_keymods("End", evt); break;
                    case 36: hack = add_keymods("Home", evt); break;

                    // These may be different on Safari...
                    case 112: hack = add_keymods("F1", evt); break;
                    case 113: hack = add_keymods("F2", evt); break;
                    case 114: hack = add_keymods("F3", evt); break;
                    case 115: hack = add_keymods("F4", evt); break;
                    case 116: hack = add_keymods("F5", evt); break;
                    case 117: hack = add_keymods("F6", evt); break;
                    case 118: hack = add_keymods("F7", evt); break;
                    case 119: hack = add_keymods("F8", evt); break;
                    case 120: hack = add_keymods("F9", evt); break;
                    case 121: hack = add_keymods("F10", evt); break;
                    case 122: hack = add_keymods("F11", evt); break;
                    case 123: hack = add_keymods("F12", evt); break;

                    // Handle weird behavior for clipboard shortcuts
                    // Which don't fire a keypress for some odd reason

                    case 65:
                        if (cmd_or_ctrl_key(evt)) { // ctrl-a
                            pdgui.pdsend(name, "selectall");
                            hack = 0; // not sure what to report here...
                        }
                        break;
                    case 88:
                        if (cmd_or_ctrl_key(evt)) { // ctrl-x
                            pdgui.pdsend(name, "cut");
                            hack = 0; // not sure what to report here...
                        }
                        break;
                    case 67:
                        if (cmd_or_ctrl_key(evt)) { // ctrl-c
                            pdgui.pdsend(name, "copy");
                            hack = 0; // not sure what to report here...
                        }
                        break;
                    case 86:
                        if (cmd_or_ctrl_key(evt)) { // ctrl-v
                            // Crazy workaround: instead of sending the
                            // "paste" message to Pd here, we wait for the
                            // "paste" listener to pick it up. That way it
                            // can check to see if there's anything in the
                            // paste buffer, and if so forward it to Pd.

                            // We could also use "cut" and "copy" handlers
                            // above for symmetry, but we're not currently
                            // doing anything with those buffers.
                            //pdgui.pdsend(name, "paste");
                            hack = 0; // not sure what to report here...
                        }
                        break;

                    // Need to handle Control key, Alt

                    case 16: hack = "Shift"; break;
                    case 17: hack = "Control"; break;
                    case 18: hack = "Alt"; break;
                }
                if (hack !== null) {
                    pdgui.canvas_sendkey(name, 1, evt, hack, keydown_autorepeat);
                    pdgui.set_keymap(key_code, hack);
                }

                //pdgui.post("keydown time: keycode is " + evt.keyCode);
                last_keydown = evt.keyCode;
                //evt.stopPropagation();
                //evt.preventDefault();
            },
            keypress: function(evt) {
                // Hack to handle undo/redo shortcuts. Other menu shortcuts are
                // in pd_menus. It'd be best to have a JSON file called
                // pd_shortcuts.js so we can keep them all in a central
                // location, but that's a bigger project.
                if (evt.charCode === 26) {
                    if (cmd_or_ctrl_key(evt)) {
                        if (evt.shiftKey === true) { // ctrl-Shift-z
                            pdgui.pdsend(name, "redo");
                        } else { // ctrl-z
                            pdgui.pdsend(name, "undo");
                        }
                        return;
                    }
                }
                // For some reasons <ctrl-e> registers a keypress with
                // charCode of 5. We filter that out here so it doesn't
                // cause trouble when toggling editmode.
                if (evt.charCode !== 5) {
                    pdgui.canvas_sendkey(name, 1, evt, evt.charCode,
                        keydown_autorepeat);
                pdgui.set_keymap(last_keydown, evt.charCode, keydown_autorepeat);
                }
                //pdgui.post("keypress time: charcode is " + evt.charCode);
                // Don't do things like scrolling on space, arrow keys, etc.
                //evt.stopPropagation();
                evt.preventDefault();
            },
            keyup: function(evt) {
                var my_char_code = pdgui.get_char_code(evt.keyCode);
                // Sometimes we don't have char_code. For example, the
                // nw menu doesn't propogate shortcut events, so we don't get
                // to map a charcode on keydown/keypress. In those cases we'll
                // get null, so we check for that here...
                if (my_char_code) {
                    pdgui.canvas_sendkey(name, 0, evt, my_char_code, evt.repeat);
                }
                //pdgui.post("keyup time: charcode is: " + my_char_code);
                if (evt.keyCode === 13 && cmd_or_ctrl_key(evt)) {
                    pdgui.pdsend(name, "reselect");
                }
                evt.stopPropagation();
                evt.preventDefault();
            },
            text_mousemove: function(evt) {
                evt.stopPropagation();    
                //evt.preventDefault();
                return false;
            },
            text_mousedown: function(evt) {
                if (textbox() !== evt.target && !target_is_scrollbar(evt)) {
                    // Yes: I _really_ want .innerText and NOT .textContent
                    // here.  I want those newlines: although that isn't
                    // standard in Pd-Vanilla, Pd-l2ork uses and preserves
                    // them inside comments
                    utils.create_obj();
                    //var fudi_msg = text_to_fudi(textbox().innerText);
                    //pdgui.pdsend(name, "createobj", fudi_msg);
                    //pdgui.post("formatted content is " + fudi_msg);
                    events.mousedown(evt);
                    canvas_events.normal();
                }
                evt.stopPropagation();    
                //evt.preventDefault();
                return false;
            },
            text_mouseup: function(evt) {
                //pdgui.post("mouseup target is " +
                //    evt.target + " and textbox is " + textbox());
                //evt.stopPropagation();    
                //evt.preventDefault();
                return false;
            },
            text_keydown: function(evt) {
                evt.stopPropagation();    
                //evt.preventDefault();
                return false;
            },
            text_keyup: function(evt) {
                evt.stopPropagation();    
                //evt.preventDefault();
                // ctrl-Enter to instantiate object
                if (evt.keyCode === 13 && cmd_or_ctrl_key(evt)) {
                    canvas_events.text(); // anchor the object
                    canvas_events.set_obj();
                    pdgui.pdsend(name, "reselect");
                }
                return false;
            },
            text_keypress: function(evt) {
                evt.stopPropagation();    
                //evt.preventDefault();
                return false;
            },
            floating_text_click: function(evt) {
                if (target_is_scrollbar(evt)) {
                    return;
                }
                //pdgui.post("leaving floating mode");
                canvas_events.text();
                evt.stopPropagation();
                evt.preventDefault();
                return false;
            },
            floating_text_keypress: function(evt) {
                //pdgui.post("leaving floating mode");
                canvas_events.text();
                //evt.stopPropagation();
                //evt.preventDefault();
                //return false;
            },
            find_click: function(evt) {
                var t = document.getElementById("canvas_find_text").value;
                if (t !== "") {
                    if (t === last_search_term) {
                        pdgui.pdsend(name, "findagain");
                    } else {
                        pdgui.pdsend(name, "find",
                        encode_for_dialog(t),
                        match_words_state ? "1" : "0");
                    }
                }
                last_search_term = t;
            },
            find_keydown: function(evt) {
                if (evt.keyCode === 13) {
                    events.find_click(evt);
                }
            },
            scalar_draggable_mousemove: function(evt) {
                var new_x = evt.pageX,
                    new_y = evt.pageY;
                var obj = scalar_draggables[draggable_elem.id];
                pdgui.pdsend(obj.cid, "scalar_event", obj.scalar_sym, 
                    obj.drawcommand_sym, obj.event_name, new_x - last_draggable_x,
                    new_y - last_draggable_y);
                last_draggable_x = new_x;
                last_draggable_y = new_y;
            },
            scalar_draggable_mouseup: function(evt) {
                canvas_events.normal();
            },
            iemgui_label_mousemove: function(evt) {
                var dx = (evt.pageX + svg_view.x) - last_draggable_x,
                    dy = (evt.pageY + svg_view.y) - last_draggable_y,
                    handle_elem =
                        document.querySelector(".clickable_resize_handle"),
                    target_id = "_h" +
                        handle_elem.parentNode.id.slice(0,-4).slice(1),
                    is_canvas_gop_rect = document.
                        getElementsByClassName("gop_drag_handle").length ?
                        true : false;

                last_draggable_x = evt.pageX + svg_view.x;
                last_draggable_y = evt.pageY + svg_view.y;

                if (!is_canvas_gop_rect) {
                    handle_elem.x.baseVal.value += dx;
                    handle_elem.y.baseVal.value += dy;
                }

                pdgui.pdsend(target_id, "_motion",
                    (evt.pageX + svg_view.x),
                    (evt.pageY + svg_view.y));
            },
            iemgui_label_mouseup: function(evt) {
                //pdgui.post("lifting the mousebutton on an iemgui label");
                // Set last state (none doesn't count as a state)
                //pdgui.post("previous state is " + canvas_events.get_previous_state());
                canvas_events[canvas_events.get_previous_state()]();
            }
        },
        utils = {
            create_obj: function() {
                var fudi_msg = text_to_fudi(textbox().innerText);
                pdgui.pdsend(name, "createobj", fudi_msg);
                //pdgui.post("formatted content is " + fudi_msg);
            },
            set_obj: function() {
                var fudi_msg = text_to_fudi(textbox().innerText);
                pdgui.pdsend(name, "setobj", fudi_msg);
                //pdgui.post("formatted content is " + fudi_msg);
            }
        }
    ;

    // Dialog events -- these are set elsewhere now because of a bug
    // with nwworkingdir
    document.querySelector("#saveDialog").addEventListener("change",
        function(evt) {
            pdgui.saveas_callback(name, this.value, 0);
            // reset value so that we can open the same file twice
            this.value = null;
            console.log("tried to save something");
        }, false
    );

    // Whoa-- huge workaround!
    // Right now we're getting the popup menu the way Pd Vanilla does it:
    // 1) send a mouse(down) message to Pd
    // 2) Pd checks whether it wants to send us a popup
    // 3) Pd checks what popup menu items are available for this object/canvas
    // 4) Pd sends GUI back a message with this info
    // 5) GUI finally displays the popup
    // 6) GUI keeps a _global_ _variable_ to remember where the popup coords
    // 7) User clicks an option in the popup
    // 8) GUI sends a message back to Pd with the popup index and coords
    // 9) Pd walks the linked list of objects to look up the object
    // 10) Pd asks that object if it reacts to popups, and if it reacts to the
    //     selected item in the popup
    // 11) Pd sends a message to the relevant object for the item in question
    // nw.js has a nice little "contextmenu" event handler, but it's too
    // difficult to use when we're passing between GUI and Pd (twice). In the
    // future we should just do all the popup menu event handling in the GUI,
    // and only pass a message to Pd when the user has clicked an item.
    // For now, however, we just turn off its default behavior and control
    // it with a bunch of complicated callbacks. :(
    document.addEventListener("contextmenu", function(evt) {
        console.log("got a context menu evt...");
        evt.preventDefault();
    });

    // Listen to paste event using the half-baked Clipboard API from HTML5
    document.addEventListener("paste", function(evt) {
        var clipboard_data = evt.clipboardData.getData("text"),
            line,
            lines,
            i,
            pd_message;
        // Precarious, overly complicated and prone to bugs...
        // Basically, if a Pd user copies some Pd source file from another
        // application, we give them a single paste operation to paste the
        // code directly into a window (empty or otherwise). We supply a
        // warning prompt to let the user know this is what's happening, so
        // they could cancel if that's not what they wanted.

        // After the prompt, the user can no longer paste that particular
        // string from the OS clipboard buffer. All paste actions
        // will instead apply to whatever has been copied or cut from within
        // a Pd patch. To paste from the OS clipboard again, the user
        // must cut/copy a _different_ snippet of Pd source file than the
        // one they previously tried to paste.

        // A temporary workaround to this confusing behavior would be to give
        // external code-pasting its own menu button. Another possibility is
        // to let copy/cut actions within the patch actually get written to
        // the OS clipboard. The latter would involve a lot more work (e.g.,
        // sending FUDI messages from Pd to set the OS clipboard, etc.)

        // Also, we check below to make sure the OS clipboard is holding
        // text that could conceivably be Pd source code. If not then the
        // user won't get bothered with a prompt at all, and normal Pd
        // paste behavior will follow.

        // Finally, from a usability standpoint the main drawback is that
        // you can't try to paste the same Pd source code more than once.
        // For users who want to pasting lots of source code this could be
        // a frustration, but Pd's normal copy/paste behavior remains
        // intuitive and in line with the way other apps tend to work.

        if (might_be_a_pd_file(clipboard_data) &&
            clipboard_data !== pdgui.get_last_clipboard_data()) {
            if (permission_to_paste_from_external_clipboard()) {
                // clear the buffer
                pdgui.pdsend(name, "copyfromexternalbuffer");
                pd_message = "";
                lines = clipboard_data.split("\n");
                for (i = 0; i < lines.length; i++) {
                    line = lines[i];
                    // process pd_message if it ends with a semicolon that
                    // isn't preceded by a backslash
                    if (line.slice(-1) === ";" &&
                         (line.length < 2 || line.slice(-2, -1) !== "\\")) {
                        if (pd_message === "") {
                            pd_message = line;
                        } else {
                            pd_message = pd_message + " " + line;
                        }
                        pdgui.pdsend(name, "copyfromexternalbuffer", pd_message);
                        pd_message = "";
                    } else {
                        pd_message = pd_message + " " + line;
                        pd_message = pd_message.replace(/\n/g, "");
                    }
                }
                // This isn't needed, but pd-l2ork did it for some reason...
                pdgui.pdsend(name, "copyfromexternalbuffer");
            }
            pdgui.set_last_clipboard_data(clipboard_data);
        }
        // Send a canvas "paste" message to Pd
        pdgui.pdsend(name, "paste");
    });

    // The following is commented out because we have to set the
    // event listener inside nw_create_pd_window_menus due to a
    // bug with nwworkingdir

    //document.querySelector("#fileDialog").addEventListener("change",
    //    function(evt) {
    //        var file_array = this.value;
    //        // reset value so that we can open the same file twice
    //        this.value = null;
    //        pdgui.menu_open(file_array);
    //        console.log("tried to open something\n\n\n\n\n\n\n\n");
    //    }, false
    //);
    document.querySelector("#openpanel_dialog").addEventListener("change",
        function(evt) {
            var file_string = this.value;
            // reset value so that we can open the same file twice
            this.value = null;
            pdgui.file_dialog_callback(file_string);
            console.log("tried to openpanel something");
        }, false
    );
    document.querySelector("#savepanel_dialog").addEventListener("change",
        function(evt) {
            var file_string = this.value;
            // reset value so that we can open the same file twice
            this.value = null;
            pdgui.file_dialog_callback(file_string);
            console.log("tried to savepanel something");
        }, false
    );
    document.querySelector("#canvas_find_text").addEventListener("focusin",
        canvas_find_focus, false
    );
    document.querySelector("#canvas_find_text").addEventListener("blur",
        canvas_find_blur, false
    );
    document.querySelector("#canvas_find_button").addEventListener("click",
        events.find_click);
    // We need to separate these into nw_window events and html5 DOM events
    // closing the Window
    // this isn't actually closing the window yet
    gui.Window.get().on("close", function() {
        pdgui.pdsend(name, "menuclose 0");
    });
    // update viewport size when window size changes
    gui.Window.get().on("maximize", function() {
        pdgui.gui_canvas_getscroll(name);
    });
    gui.Window.get().on("unmaximize", function() {
        pdgui.gui_canvas_getscroll(name);
    });
    gui.Window.get().on("resize", function() {
        pdgui.gui_canvas_getscroll(name);
    });
    gui.Window.get().on("focus", function() {
        nw_window_focus_callback();
    });
    // set minimum window size
    gui.Window.get().setMinimumSize(150, 100); 

    return {
        none: function() {
            var name;
            if (state !== "none") {
                previous_state = state;
            }
            state = "none";
            for (var prop in events) {
                if (events.hasOwnProperty(prop)) {
                    name = prop.split("_");
                    name = name[name.length - 1];
                    document.removeEventListener(name, events[prop], false);
                }
            }
        },
        normal: function() {
            this.none();

            document.addEventListener("mousemove", events.mousemove, false);
            document.addEventListener("keydown", events.keydown, false);
            document.addEventListener("keypress", events.keypress, false);
            document.addEventListener("keyup", events.keyup, false);
            document.addEventListener("mousedown", events.mousedown, false);
            document.addEventListener("mouseup", events.mouseup, false);
            state = "normal";
            set_edit_menu_modals(true);
        },
        scalar_drag: function() {
            // This scalar_drag is a prototype for moving more of the editing environment 
            // directly to the GUI.  At the moment we're leaving the other "normal" 
            // events live, since behavior like editmode selection still happens from
            // the Pd engine.
            //this.none();
            document.addEventListener("mousemove", events.scalar_draggable_mousemove, false);
            document.addEventListener("mouseup", events.scalar_draggable_mouseup, false);
        },
        iemgui_label_drag: function() {
            // This is a workaround for dragging iemgui labels. Resizing iemguis
            // currently happens in Pd (canvas_doclick and canvas_motion). (Look
            // for MA_RESIZE.)
            this.none();
            document.addEventListener("mousemove",
                events.iemgui_label_mousemove, false);
            document.addEventListener("mouseup",
                events.iemgui_label_mouseup, false);
        },
        text: function() {
            this.none();

            document.addEventListener("mousemove", events.text_mousemove, false);
            document.addEventListener("keydown", events.text_keydown, false);
            document.addEventListener("keypress", events.text_keypress, false);
            document.addEventListener("keyup", events.text_keyup, false);
            document.addEventListener("mousedown", events.text_mousedown, false);
            document.addEventListener("mouseup", events.text_mouseup, false);
            state = "text";
            set_edit_menu_modals(false);
        },
        floating_text: function() {
            this.none();
            this.text();
            document.removeEventListener("mousedown", events.text_mousedown, false);
            document.removeEventListener("mouseup", events.text_mouseup, false);
            document.removeEventListener("keypress", events.text_keypress, false);
            document.removeEventListener("mousemove", events.text_mousemove, false);
            document.addEventListener("click", events.floating_text_click, false);
            document.addEventListener("keypress", events.floating_text_keypress, false);
            document.addEventListener("mousemove", events.mousemove, false);
            state = "floating_text";
            set_edit_menu_modals(false);
        },
        search: function() {
            this.none();
            document.addEventListener("keydown", events.find_keydown, false);
            state = "search";
        },
        register: function(n) {
            name = n;
        },
        get_state: function() {
            return state;
        },
        get_previous_state: function() {
            return previous_state;
        },
        set_obj: function() {
            utils.set_obj();
        },
        create_obj: function() {
            utils.create_obj();
        },
        match_words: function(state) {
            match_words_state = state;
        },
        add_scalar_draggable: function(cid, tag, scalar_sym, drawcommand_sym,
            event_name) {
            scalar_draggables[tag] = {
                cid: cid,
                scalar_sym: scalar_sym,
                drawcommand_sym, drawcommand_sym,
                event_name: event_name
            };
        },
        remove_scalar_draggable: function(id) {
            if (scalar_draggables[id]) {
                scalar_draggables[id] = null;
            }
        },
        save_and_close: function() {
            pdgui.pdsend(name, "menusave", 1);
        },
        close_without_saving: function(cid, force) {
            pdgui.pdsend(name, "dirty 0");
            pdgui.pdsend(cid, "menuclose", force);
        }
    }
}());

// Stop-gap translator. We copy/pasted this in each dialog, too. It
// should be moved to pdgui.js
function translate_form() {
    var i
    var elements = document.querySelectorAll("[data-i18n]");
    for (i = 0; i < elements.length; i++) {
        var data = elements[i].dataset.i18n;
        if (data.slice(0,7) === "[title]") {
            elements[i].title = l(data.slice(7));
        } else {
            elements[i].textContent = l(data);
        }
    }
}

// This gets called from the nw_create_window function in index.html
// It provides us with our canvas id from the C side.  Once we have it
// we can create the menu and register event callbacks
function register_window_id(cid, attr_array) {
    name = cid; // hack
    // We create the window menus and popup menu before doing anything else
    // to ensure that we don't try to set the svg size before these are done.
    // Otherwise we might set the svg size to the window viewport, only to have
    // the menu push down the svg viewport and create scrollbars. Those same
    // scrollbars will get erased once canvas_map triggers, causing a quick
    // (and annoying) scrollbar flash.
    // For OSX, we have a single menu and just track which window has the
    // focus.
    if (process.platform !== "darwin") {
        nw_create_patch_window_menus(gui, window, cid);
    }
    create_popup_menu(cid);
    canvas_events.register(cid);
    translate_form();
    // Trigger a "focus" event so that OSX updates the menu for this window
    nw_window_focus_callback();
    canvas_events.normal();
    pdgui.canvas_map(cid); // side-effect: triggers gui_canvas_getscroll from Pd
    set_editmode_checkbox(attr_array.editmode !== 0 ? true : false);
    // For now, there is no way for the cord inspector to be turned on by
    // default. But if this changes we need to set its menu item checkbox
    // accordingly here
    //set_cord_inspector_checkbox();
}

function create_popup_menu(name) {
    // The right-click popup menu
    var popup_menu = new gui.Menu();
    pdgui.add_popup(name, popup_menu);

    popup_menu.append(new gui.MenuItem({
        label: "Properties",
        click: function() {
            pdgui.popup_action(name, 0);
        }
    }));
    popup_menu.append(new gui.MenuItem({
        label: "Open",
        click: function() {
            pdgui.popup_action(name, 1);
        }
    }));
    popup_menu.append(new gui.MenuItem({
        label: "Help",
        click: function() {
            pdgui.popup_action(name, 2);
        }
    }));
}

function nw_undo_menu(undo_text, redo_text) {
    if (undo_text === "no") {
        canvas_menu.edit.undo.enabled = false;
    } else {
        canvas_menu.edit.undo.enabled = true;
        canvas_menu.edit.undo.label = l("menu.undo") + " " + undo_text;
    }
    if (redo_text === "no") {
        canvas_menu.edit.redo.enabled = false;
    } else {
        canvas_menu.edit.redo.enabled = true;
        canvas_menu.edit.redo.label = l("menu.redo") + " " + redo_text;
    }
}

function have_live_box() {
    var state = canvas_events.get_state();
    if (state === "text" || state === "floating_text") {
        return true;
    } else {
        return false;
    }
}

// If there's a box being edited, send the box's text to Pd
function update_live_box() {
    if (have_live_box()) {
        canvas_events.set_obj();
    }
}

// If there's a box being edited, try to instantiate it in Pd
function instantiate_live_box() {
    if (have_live_box()) {
        canvas_events.create_obj();
    }
}

// Menus for the Patch window

var canvas_menu = {};

function set_edit_menu_modals(state) {
    canvas_menu.edit.undo.enabled = state;
    canvas_menu.edit.redo.enabled = state;
    canvas_menu.edit.cut.enabled = state;
    canvas_menu.edit.copy.enabled = state;
    canvas_menu.edit.paste.enabled = state;
}

function set_editmode_checkbox(state) {
    canvas_menu.edit.editmode.checked = state;
}

function set_cord_inspector_checkbox(state) {
    canvas_menu.edit.cordinspector.checked = state;
}

// stop-gap
function menu_generic () {
    alert("Please implement this");
}

function minit(menu_item, options) {
    var key;
    for (key in options) {
        if (options.hasOwnProperty(key)) {
            // For click callbacks, we want to check if canvas state is
            // "none", in which case we don't call them. This is just a
            // hack, though-- it'd be a better UX to disable all menu items
            // when we're in the "none" state.
            menu_item[key] = (key !== "click") ?
                options[key] :
                function() {
                    if (canvas_events.get_state() !== "none") {
                        options[key]();
                    }
            };
        }
    }
}

function nw_create_patch_window_menus(gui, w, name) {
    // if we're on GNU/Linux or Windows, create the menus:
    var m = canvas_menu = pd_menus.create_menu(gui);

    // File sub-entries
    // We explicitly enable these menu items because on OSX
    // the console menu disables them. (Same for Edit and Put menu)
    minit(m.file.new_file, { click: pdgui.menu_new });
    minit(m.file.open, {
        click: function() {
            var input, chooser,
                span = w.document.querySelector("#fileDialogSpan");
            input = pdgui.build_file_dialog_string({
                style: "display: none;",
                type: "file",
                id: "fileDialog",
                nwworkingdir: "/user/home",
                multiple: null,
                accept: ".pd,.pat,.mxt,.mxb,.help"
            });
            span.innerHTML = input;
            chooser = w.document.querySelector("#fileDialog");
            // Hack-- we have to set the event listener here because we
            // changed out the innerHTML above
            chooser.onchange = function() {
                var file_array = this.value;
                // reset value so that we can open the same file twice
                this.value = null;
                pdgui.menu_open(file_array);
                console.log("tried to open something");
            };
            chooser.click();
        }
    });
    if (pdgui.k12_mode == 1) {
        minit(m.file.k12, { click: pdgui.menu_k12_open_demos });
    }
    minit(m.file.save, {
        enabled: true,
        click: function () {
            pdgui.canvas_check_geometry(name); // should this go in menu_save?
            pdgui.menu_save(name);
        },
    });
    minit(m.file.saveas, {
        enabled: true,
        click: function (){
            pdgui.canvas_check_geometry(name);
            pdgui.menu_saveas(name);
        },
    });
    minit(m.file.message, {
        click: function() { pdgui.menu_send(name); }
    });
    minit(m.file.close, {
        enabled: true,
        click: function() { pdgui.menu_close(name); }
    });
    minit(m.file.quit, {
        click: pdgui.menu_quit,
    });

    // Edit menu
    minit(m.edit.undo, {
        enabled: true,
        click: function () { pdgui.pdsend(name, "undo"); }
    });
    minit(m.edit.redo, {
        enabled: true,
        click: function () { pdgui.pdsend(name, "redo"); }
    });
    minit(m.edit.cut, {
        enabled: true,
        click: function () { pdgui.pdsend(name, "cut"); }
    });
    minit(m.edit.copy, {
        enabled: true,
        click: function () { pdgui.pdsend(name, "copy"); }
    });
    minit(m.edit.paste, {
        enabled: true,
        click: function () { pdgui.pdsend(name, "paste"); }
    });
    minit(m.edit.duplicate, {
        enabled: true,
        click: function () { pdgui.pdsend(name, "duplicate"); }
    });
    minit(m.edit.selectall, {
        enabled: true,
        click: function (evt) {
            if (canvas_events.get_state() === "normal") {
                pdgui.pdsend(name, "selectall");
            }
        }
    });
    minit(m.edit.clear_console, {
        enabled: true,
        click: pdgui.clear_console
    });
    minit(m.edit.reselect, {
        enabled: true,
        click: function() { pdgui.pdsend(name, "reselect"); }
    });
    minit(m.edit.tidyup, {
        enabled: true,
        click: function() { pdgui.pdsend(name, "tidy"); }
    });
    minit(m.edit.tofront, {
        enabled: true,
        click: function() { pdgui.popup_action(name, 3); }
    });
    minit(m.edit.toback, {
        enabled: true,
        click: function() { pdgui.popup_action(name, 4); }
    });
    minit(m.edit.font, {
        enabled: true,
        click: function () { pdgui.pdsend(name, "menufont"); }
    });
    minit(m.edit.cordinspector, {
        enabled: true,
        click: function() { pdgui.pdsend(name, "magicglass 0"); }
    });
    minit(m.edit.find, {
        click: function () {
            var find_bar = w.document.getElementById("canvas_find"),
                find_bar_text = w.document.getElementById("canvas_find_text"),
                state = find_bar.style.getPropertyValue("display");
            // if there's a box being edited, try to instantiate it in Pd
            instantiate_live_box();
            if (state === "none") {
                find_bar.style.setProperty("display", "inline");
                find_bar_text.focus();
                find_bar_text.select();
                canvas_events.search();
            } else {
                find_bar.style.setProperty("display", "none");
                // "normal" seems to be the only viable state for the
                // canvas atm.  But if there are other states added later,
                // we might need to fetch the previous state here.
                canvas_events.normal();
            }
        }
    });
    minit(m.edit.findagain, {
        enabled: true,
        click: function() {
            pdgui.pdsend(name, "findagain");
        }
    });
    minit(m.edit.finderror, {
        enabled: true,
        click: function() {
            pdgui.pdsend("pd finderror");
        }
    });
    minit(m.edit.autotips, {
        enabled: true,
        click: menu_generic
    });
    minit(m.edit.editmode, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "editmode 0");
        }
    });
    minit(m.edit.preferences, {
        click: pdgui.open_prefs
    });

    // View menu
    minit(m.view.zoomin, {
        enabled: true,
        click: function () {
            var z = gui.Window.get().zoomLevel;
            if (z < 8) { z++; }
            gui.Window.get().zoomLevel = z;
        }
    });
    minit(m.view.zoomout, {
        enabled: true,
        click: function () {
            var z = gui.Window.get().zoomLevel;
            if (z > -7) { z--; } 
            gui.Window.get().zoomLevel = z;
        }
    });
    minit(m.view.zoomreset, {
        enabled: true,
        click: function () {
            gui.Window.get().zoomLevel = 0;
        }
    });
    minit(m.view.fullscreen, {
        click: function() {
            var win = gui.Window.get();
            var fullscreen = win.isFullscreen;
            win.isFullscreen = !fullscreen;
            pdgui.post("fullscreen is " + fullscreen);
        }
    });

    // Put menu
    minit(m.put.object, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "obj 0");
        }
    });
    minit(m.put.message, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "msg 0");
        }
    });
    minit(m.put.number, {
        enabled: true,
        click: function() { 
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "floatatom 0");
        }
    });
    minit(m.put.symbol, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "symbolatom 0");
        }
    });
    minit(m.put.comment, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "text 0");
        }
    });
    minit(m.put.bang, {
        enabled: true,
        click: function(e) {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "bng 0");
        }
    });
    minit(m.put.toggle, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "toggle 0");
        }
    });
    minit(m.put.number2, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "numbox 0");
        }
    });
    minit(m.put.vslider, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "vslider 0");
        }
    });
    minit(m.put.hslider, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "hslider 0");
        }
    });
    minit(m.put.vradio, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "vradio 0");
        }
    });
    minit(m.put.hradio, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "hradio 0");
        }
    });
    minit(m.put.vu, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "vumeter 0");
        }
    });
    minit(m.put.cnv, {
        enabled: true,
        click: function() {
            update_live_box();
            pdgui.pdsend(name, "dirty 1");
            pdgui.pdsend(name, "mycnv 0");
        }
    });
    //minit(m.put.graph, {
    //    enabled: true,
    //    click: function() {
    //        update_live_box();
    //        pdgui.pdsend(name, "dirty 1");
    //        // leaving out some placement logic... see pd.tk menu_graph
    //        pdgui.pdsend(name, "graph NULL 0 0 0 0 30 30 0 30");
    //    },
    //});
    minit(m.put.array, {
        enabled: true,
        click: function() {
                update_live_box();
                pdgui.pdsend(name, "dirty 1");
                pdgui.pdsend(name, "menuarray");
            }
    });

    // Window
    minit(m.win.nextwin, {
        click: function() {
            pdgui.raise_next(name);
        }
    });
    minit(m.win.prevwin, {
        click: function() {
            pdgui.raise_prev(name);
        }
    });
    minit(m.win.parentwin, {
        enabled: true,
        click: function() {
            pdgui.pdsend(name, "findparent", 0);
        }
    });
    minit(m.win.visible_ancestor, {
        enabled: true,
        click: function() {
            pdgui.pdsend(name, "findparent", 1);
        }
    });
    minit(m.win.pdwin, {
        enabled: true,
        click: function() {
            pdgui.raise_pd_window();
        }
    });

    // Media menu
    minit(m.media.audio_on, {
        click: function() {
            pdgui.pdsend("pd dsp 1");
        }
    });
    minit(m.media.audio_off, {
        click: function() {
            pdgui.pdsend("pd dsp 0");
        }
    });
    minit(m.media.test, {
        click: function() {
            pdgui.pd_doc_open("doc/7.stuff/tools", "testtone.pd");
        }
    });
    minit(m.media.loadmeter, {
        click: function() {
            pdgui.pd_doc_open("doc/7.stuff/tools", "load-meter.pd");
        }
    });

    // Help menu
    minit(m.help.about, {
        click: function() {
            pdgui.pd_doc_open("doc/1.manual", "1.introduction.txt");
        }
    });
    minit(m.help.manual, {
        click: function() {
            pdgui.pd_doc_open("doc/1.manual", "index.htm");
        }
    });
    minit(m.help.browser, {
        click: function() {
            alert("please implement a help browser");
        }
    });
    minit(m.help.l2ork_list, {
        click: function() {
            pdgui.external_doc_open("http://disis.music.vt.edu/listinfo/l2ork-dev");
        }
    });
    minit(m.help.pd_list, {
        click: function() {
            pdgui.external_doc_open("http://puredata.info/community/lists");
        }
    });
    minit(m.help.forums, {
        click: function() {
            pdgui.external_doc_open("http://forum.pdpatchrepo.info/");
        }
    });
    minit(m.help.irc, {
        click: menu_generic
    });
    minit(m.help.devtools, {
        click: function () {
            gui.Window.get().showDevTools();
        }
    });
}
