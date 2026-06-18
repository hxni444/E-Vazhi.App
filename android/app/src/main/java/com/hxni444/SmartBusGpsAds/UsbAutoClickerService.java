package com.hxni444.SmartBusGpsAds;

import android.accessibilityservice.AccessibilityService;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.List;

public class UsbAutoClickerService extends AccessibilityService {

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            event.getEventType() == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            
            AccessibilityNodeInfo rootNode = getRootInActiveWindow();
            if (rootNode != null) {
                // Search for and click the "OK" or "Allow" buttons on the USB pop-up
                boolean clicked = clickNodeByText(rootNode, "OK");
                if (!clicked) clicked = clickNodeByText(rootNode, "ALLOW");
                if (!clicked) clickNodeByText(rootNode, "Allow");
            }
        }
    }

    private boolean clickNodeByText(AccessibilityNodeInfo nodeInfo, String text) {
        List<AccessibilityNodeInfo> list = nodeInfo.findAccessibilityNodeInfosByText(text);
        for (AccessibilityNodeInfo node : list) {
            if (node.isClickable()) {
                node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                Log.d("UsbAutoClicker", "Clicked button: " + text);
                return true;
            } else {
                AccessibilityNodeInfo parent = node.getParent();
                while (parent != null) {
                    if (parent.isClickable()) {
                        parent.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                        Log.d("UsbAutoClicker", "Clicked parent of button: " + text);
                        return true;
                    }
                    parent = parent.getParent();
                }
            }
        }
        return false;
    }

    @Override
    public void onInterrupt() {
    }
}
