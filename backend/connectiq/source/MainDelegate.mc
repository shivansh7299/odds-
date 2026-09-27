import Toybox.Lang;
import Toybox.WatchUi;

class MainDelegate extends WatchUi.BehaviorDelegate {
    private var _c as Controller;

    function initialize(controller as Controller) {
        BehaviorDelegate.initialize();
        _c = controller;
    }

    //! START: pair when unpaired.
    function onSelect() as Boolean {
        if (_c.state == Controller.UNPAIRED) {
            _c.startPairing();
        }
        return true;
    }

    //! Hold UP (menu): offer to unpair.
    function onMenu() as Boolean {
        if (_c.state == Controller.STREAMING) {
            WatchUi.pushView(
                new WatchUi.Confirmation("Unpair this watch?"),
                new UnpairDelegate(_c),
                WatchUi.SLIDE_UP
            );
        }
        return true;
    }
}

class UnpairDelegate extends WatchUi.ConfirmationDelegate {
    private var _c as Controller;

    function initialize(controller as Controller) {
        ConfirmationDelegate.initialize();
        _c = controller;
    }

    function onResponse(response as WatchUi.Confirm) as Boolean {
        if (response == WatchUi.CONFIRM_YES) {
            _c.unpair();
        }
        return true;
    }
}
