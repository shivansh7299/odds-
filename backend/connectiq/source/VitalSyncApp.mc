import Toybox.Application;
import Toybox.Background;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

//! Entry point. Annotated (:background) because the same class is loaded by the
//! background process that runs BackgroundService every 5 minutes.
(:background)
class VitalSyncApp extends Application.AppBase {
    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary?) as Void {
    }

    function onStop(state as Dictionary?) as Void {
    }

    //! Only ever called in the foreground process, so it may use foreground-only classes.
    (:typecheck(disableBackgroundCheck))
    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        var controller = new Controller();
        if (Config.token() != null) {
            scheduleBackground();
        }
        return [new MainView(controller), new MainDelegate(controller)];
    }

    function getServiceDelegate() as [System.ServiceDelegate] {
        return [new BackgroundService()];
    }

    //! Result of the last background upload, shown on the main screen.
    function onBackgroundData(data as Application.PersistableType) as Void {
        if (data instanceof Dictionary) {
            var code = data["code"];
            Application.Storage.setValue("lastBackground", { "code" => code instanceof Number ? code : -1 });
            if (code instanceof Number && code == 401) {
                Application.Storage.deleteValue(Config.TOKEN_KEY); // revoked on the dashboard
            }
        }
        WatchUi.requestUpdate();
    }
}

//! Temporal events run at most every 5 minutes on Connect IQ.
function scheduleBackground() as Void {
    if (Toybox has :Background) {
        Background.registerForTemporalEvent(new Time.Duration(5 * 60));
    }
}

function getApp() as VitalSyncApp {
    return Application.getApp() as VitalSyncApp;
}
