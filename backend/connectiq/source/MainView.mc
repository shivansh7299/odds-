import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

class MainView extends WatchUi.View {
    private var _c as Controller;

    function initialize(controller as Controller) {
        View.initialize();
        _c = controller;
    }

    function onShow() as Void {
        _c.onShow();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        dc.setColor(0x3987E5, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.14, Graphics.FONT_XTINY, "VitalSync", Graphics.TEXT_JUSTIFY_CENTER);

        if (_c.state == Controller.SHOWING_CODE && _c.userCode != null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.30, Graphics.FONT_XTINY, "Pairing code", Graphics.TEXT_JUSTIFY_CENTER);
            dc.drawText(cx, h * 0.40, Graphics.FONT_MEDIUM, _c.userCode as String, Graphics.TEXT_JUSTIFY_CENTER);
        } else if (_c.state == Controller.STREAMING) {
            var bpm = _c.bpm;
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.28, Graphics.FONT_NUMBER_HOT, bpm != null ? bpm.toString() : "--", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.55, Graphics.FONT_XTINY, "bpm · " + _c.sent.toString() + " sent", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.38, Graphics.FONT_SMALL, "Not paired", Graphics.TEXT_JUSTIFY_CENTER);
        }

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.70, Graphics.FONT_XTINY, _c.message, Graphics.TEXT_JUSTIFY_CENTER);

        var bg = Application.Storage.getValue("lastBackground");
        if (bg instanceof Dictionary) {
            var code = bg["code"];
            if (code instanceof Number) {
                dc.drawText(cx, h * 0.80, Graphics.FONT_XTINY, "bg sync: " + code.toString(), Graphics.TEXT_JUSTIFY_CENTER);
            }
        }
    }
}
